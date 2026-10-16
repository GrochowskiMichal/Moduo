-- Chat v2 · CV-20 Custom emoji (specs/chat-v2.md §6, §12, §15; CH16b;
-- §Assumptions #15, #18, #31, #35; .design/chat-v2/research/round-3-database.md
-- §2.2, §2.8, §2.9). The stamp is fixed by the build's queue (after CV-16,
-- CV-18, CV-22, CV-14). It runs again cleanly over itself.
--
-- What it does:
--   1. The "Add custom emoji" switch: workspace_chat_caps.add_emoji (on for
--      admins and members, off for viewers), in new workspaces' rows, in
--      chat_has_cap and chat_caps_set (a viewer's stays off). chat_caps_get
--      returns whole rows, so it carries the column as it is.
--   2. One reaction key for standard and custom emoji: reactions__key_ok also
--      takes `:name:` (reactions__custom_key_pattern(), the same name rule as
--      the table), and reactions__key_canonical leaves a `:name:` as it is.
--      The key check stays a shape check (it backs a CHECK); whether a
--      `:name:` is live in a workspace is the ops' question (step 7). A
--      status's emoji (user_statuses__parts) stays a standard one.
--   3. chat_custom_emoji: id, workspace, name, the image and its still frame,
--      type, size, pixels, animated, who added it, soft delete. Names are 2–32
--      of a–z, 0–9, - and _ with at least one letter, unique per workspace
--      among live emoji, and never a standard emoji's shortcode. Everyone in
--      the workspace reads it (paused chat still reads); only the ops write.
--      Published, so an add or a removal reaches open apps.
--   4. Storage bucket chat-emoji (private): PNG, GIF, WebP, 256 KB. Paths
--      `<workspace>/<slot>.<ext>` and `<workspace>/<slot>.poster.png`, where
--      the slot is an id the server mints for one uploader in one workspace
--      (chat_op_custom_emoji_begin). Uploading needs your own open slot in that
--      folder and the switch; reading needs membership; nobody overwrites or
--      deletes an image.
--   5. chat_op_custom_emoji_begin(ws) → slot; chat_op_custom_emoji_add(slot,
--      name, mime, width, height, bytes, animated): signed in, chat on the
--      plan, the switch, your own unused slot, the name, the type (its
--      extension is the server's), the size, both images uploaded by you into
--      that slot with that type and size, at most 500 live per workspace.
--      chat_op_custom_emoji_remove(id): its adder or an admin; a soft delete.
--      Activity chat.emoji_add / chat.emoji_remove.
--   6. chat_op_react and comments_op_react take a `:name:` only while it
--      names a live emoji of the message's or comment's workspace (taking a
--      reaction back always works, so a removed emoji's reactions can go).
--   7. Account erasure: the emoji someone added stay with the workspace, no
--      longer attributed to them (created_by → null).
--
-- Every redefined function is cut from its live body (pg_temp.recut): if an
-- earlier migration changed the lines it expects, the migration stops.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  -- Already cut (a re-run): the new text may contain the old, so look for it first.
  IF position(p_new IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_def) = 0 THEN
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- ── 1. The "Add custom emoji" switch ───────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workspace_chat_caps' AND column_name = 'add_emoji'
  ) THEN
    ALTER TABLE public.workspace_chat_caps ADD COLUMN add_emoji boolean NOT NULL DEFAULT false;
    -- Admins and members by default; only when the column is new, so a re-run
    -- keeps what an admin switched since.
    UPDATE public.workspace_chat_caps SET add_emoji = true WHERE role_key IN ('admin', 'member');
  END IF;
END;
$$;

-- New workspaces get the switch on for admins and members too.
SELECT pg_temp.recut(
  'public.share_seed_workspace()'::regprocedure,
  $old$mention_everyone, post, start_calls
  )$old$,
  $new$mention_everyone, post, start_calls, add_emoji
  )$new$);
SELECT pg_temp.recut(
  'public.share_seed_workspace()'::regprocedure,
  $old$    r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key <> 'viewer'
  FROM$old$,
  $new$    r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key <> 'viewer',
    r.role_key <> 'viewer'
  FROM$new$);

SELECT pg_temp.recut(
  'public.chat_has_cap(uuid, uuid, text)'::regprocedure,
  $old$    WHEN 'start_calls' THEN v_row.start_calls
$old$,
  $new$    WHEN 'start_calls' THEN v_row.start_calls
    WHEN 'add_emoji' THEN v_row.add_emoji
$new$);

SELECT pg_temp.recut(
  'public.chat_caps_set(uuid, text, jsonb)'::regprocedure,
  $old$'mention_everyone', false, 'start_calls', false);$old$,
  $new$'mention_everyone', false, 'start_calls', false, 'add_emoji', false);$new$);
SELECT pg_temp.recut(
  'public.chat_caps_set(uuid, text, jsonb)'::regprocedure,
  $old$    start_calls = coalesce((p_caps->>'start_calls')::boolean, start_calls)
$old$,
  $new$    start_calls = coalesce((p_caps->>'start_calls')::boolean, start_calls),
    add_emoji = coalesce((p_caps->>'add_emoji')::boolean, add_emoji)
$new$);

-- ── 2. One reaction key for standard and custom emoji ──────────────────────

-- A custom emoji's key: its name between colons. The same name rule as
-- chat_custom_emoji.name and CUSTOM_EMOJI_NAME_PATTERN in @contracts (the
-- drift gate compares them).
CREATE OR REPLACE FUNCTION public.reactions__custom_key_pattern()
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT '^:(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{2,32}:$'::text
$function$;

SELECT pg_temp.recut(
  'public.reactions__key_ok(text)'::regprocedure,
  $old$     AND char_length(p_key) BETWEEN 1 AND 32
     AND p_key ~ public.reactions__key_pattern()$old$,
  $new$     AND (   (char_length(p_key) BETWEEN 1 AND 32 AND p_key ~ public.reactions__key_pattern())
          OR p_key ~ public.reactions__custom_key_pattern())$new$);

-- A `:name:` is already its one spelling (its digits aren't keycaps).
SELECT pg_temp.recut(
  'public.reactions__key_canonical(text)'::regprocedure,
  $old$    FROM c
$function$$old$,
  $new$    FROM c
   WHERE p_key !~ public.reactions__custom_key_pattern()
  UNION ALL
  SELECT p_key WHERE p_key ~ public.reactions__custom_key_pattern()
$function$$new$);

-- A status shows in every workspace, so its emoji stays a standard one (the
-- key check above now also takes `:name:`).
SELECT pg_temp.recut(
  'public.user_statuses__parts(jsonb, boolean)'::regprocedure,
  $old$(char_length(s_emoji) > 16 OR NOT public.reactions__key_ok(s_emoji))$old$,
  $new$(char_length(s_emoji) > 16 OR NOT public.reactions__key_ok(s_emoji)
                                OR s_emoji ~ public.reactions__custom_key_pattern())$new$);

-- ── 3. chat_custom_emoji ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_custom_emoji (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT chat_custom_emoji_name_check
    CHECK (name ~ '^(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{2,32}$'),
  storage_path text NOT NULL,
  poster_path text NOT NULL,
  mime text NOT NULL CONSTRAINT chat_custom_emoji_mime_check
    CHECK (mime IN ('image/png', 'image/gif', 'image/webp')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 128),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 128),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 262144),
  animated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_custom_emoji_live_name
  ON public.chat_custom_emoji (workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_custom_emoji_workspace
  ON public.chat_custom_emoji (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS chat_custom_emoji_created_by
  ON public.chat_custom_emoji (created_by) WHERE created_by IS NOT NULL;

DROP TRIGGER IF EXISTS chat_custom_emoji_stamp ON public.chat_custom_emoji;
CREATE TRIGGER chat_custom_emoji_stamp
  BEFORE UPDATE ON public.chat_custom_emoji
  FOR EACH ROW EXECUTE FUNCTION public.chat__stamp_updated_at();

-- The read rule's check, about the caller only: everyone in the workspace
-- (membership, not the plan: paused chat still reads).
CREATE OR REPLACE FUNCTION public.chat_emoji__readable(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND p_workspace_id IS NOT NULL
     AND public.chat_is_workspace_member(p_workspace_id, auth.uid())
$function$;

ALTER TABLE public.chat_custom_emoji ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_custom_emoji_read ON public.chat_custom_emoji;
-- Removed rows stay readable so a removal reaches open apps.
CREATE POLICY chat_custom_emoji_read ON public.chat_custom_emoji
  FOR SELECT TO authenticated
  USING (public.chat_emoji__readable(workspace_id));

REVOKE ALL ON public.chat_custom_emoji FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_custom_emoji TO authenticated;
GRANT ALL ON public.chat_custom_emoji TO service_role;

-- Standard emoji's shortcodes (Emojibase's GitHub set, the one the `:` menu
-- matches) that fit the name rule: a custom emoji can't take one. The drift
-- gate holds this list equal to emojibase-data/en/shortcodes/github.json.
CREATE OR REPLACE FUNCTION public.chat__emoji_name_reserved(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT p_name = ANY (
    -- reserved:begin
    '{
    1st_place_medal, 2nd_place_medal, 3rd_place_medal, 8ball, ab, abacus, abc, abcd, accept,
    accordion, adhesive_bandage, adult, aerial_tramway, afghanistan, airplane, aland_islands,
    alarm_clock, albania, alembic, algeria, alien, ambulance, american_samoa, amphora,
    anatomical_heart, anchor, andorra, angel, anger, angola, angry, anguilla, anguished, ant,
    antarctica, antigua_barbuda, apple, aquarius, argentina, aries, armenia, arrow_backward,
    arrow_double_down, arrow_double_up, arrow_down, arrow_down_small, arrow_forward,
    arrow_heading_down, arrow_heading_up, arrow_left, arrow_lower_left, arrow_lower_right,
    arrow_right, arrow_right_hook, arrow_up, arrow_up_down, arrow_up_small, arrow_upper_left,
    arrow_upper_right, arrows_clockwise, arrows_counterclockwise, art, articulated_lorry,
    artificial_satellite, artist, aruba, ascension_island, asterisk, astonished, astronaut,
    athletic_shoe, atm, atom_symbol, australia, austria, auto_rickshaw, avocado, axe,
    azerbaijan, baby, baby_bottle, baby_chick, baby_symbol, back, bacon, badger, badminton,
    bagel, baggage_claim, baguette_bread, bahamas, bahrain, balance_scale, bald_man, bald_woman,
    ballet_shoes, balloon, ballot_box, ballot_box_with_check, bamboo, banana, bangbang,
    bangladesh, banjo, bank, bar_chart, barbados, barber, baseball, basket, basketball,
    basketball_man, basketball_woman, bat, bath, bathtub, battery, beach_umbrella, beans, bear,
    bearded_person, beaver, bed, bee, beer, beers, beetle, beginner, belarus, belgium, belize,
    bell, bell_pepper, bellhop_bell, benin, bento, bermuda, beverage_box, bhutan, bicyclist,
    bike, biking_man, biking_woman, bikini, billed_cap, biohazard, bird, birthday, bison,
    biting_lip, black_bird, black_cat, black_circle, black_flag, black_heart, black_joker,
    black_large_square, black_medium_small_square, black_medium_square, black_nib,
    black_small_square, black_square_button, blond_haired_man, blond_haired_person,
    blond_haired_woman, blonde_woman, blossom, blowfish, blue_book, blue_car, blue_heart,
    blue_square, blueberries, blush, boar, boat, bolivia, bomb, bone, book, bookmark,
    bookmark_tabs, books, boom, boomerang, boot, bosnia_herzegovina, botswana,
    bouncing_ball_man, bouncing_ball_person, bouncing_ball_woman, bouquet, bouvet_island, bow,
    bow_and_arrow, bowing_man, bowing_woman, bowl_with_spoon, bowling, boxing_glove, boy, brain,
    brazil, bread, breast_feeding, bricks, bride_with_veil, bridge_at_night, briefcase,
    british_indian_ocean_territory, british_virgin_islands, broccoli, broken_heart, broom,
    brown_circle, brown_heart, brown_square, brunei, bubble_tea, bubbles, bucket, bug,
    building_construction, bulb, bulgaria, bullettrain_front, bullettrain_side, burkina_faso,
    burrito, burundi, bus, business_suit_levitating, busstop, bust_in_silhouette,
    busts_in_silhouette, butter, butterfly, cactus, cake, calendar, call_me_hand, calling,
    cambodia, camel, camera, camera_flash, cameroon, camping, canada, canary_islands, cancer,
    candle, candy, canned_food, canoe, cape_verde, capital_abcd, capricorn, car, card_file_box,
    card_index, card_index_dividers, caribbean_netherlands, carousel_horse, carpentry_saw,
    carrot, cartwheeling, cat, cat2, cayman_islands, cd, central_african_republic,
    ceuta_melilla, chad, chains, chair, champagne, chart, chart_with_downwards_trend,
    chart_with_upwards_trend, checkered_flag, cheese, cherries, cherry_blossom, chess_pawn,
    chestnut, chicken, child, children_crossing, chile, chipmunk, chocolate_bar, chopsticks,
    christmas_island, christmas_tree, church, cinema, circus_tent, city_sunrise, city_sunset,
    cityscape, cl, clamp, clap, clapper, classical_building, climbing, climbing_man,
    climbing_woman, clinking_glasses, clipboard, clipperton_island, clock1, clock10, clock1030,
    clock11, clock1130, clock12, clock1230, clock130, clock2, clock230, clock3, clock330,
    clock4, clock430, clock5, clock530, clock6, clock630, clock7, clock730, clock8, clock830,
    clock9, clock930, closed_book, closed_lock_with_key, closed_umbrella, cloud,
    cloud_with_lightning, cloud_with_lightning_and_rain, cloud_with_rain, cloud_with_snow,
    clown_face, clubs, cn, coat, cockroach, cocktail, coconut, cocos_islands, coffee, coffin,
    coin, cold_face, cold_sweat, collision, colombia, comet, comoros, compass, computer,
    computer_mouse, confetti_ball, confounded, confused, congo_brazzaville, congo_kinshasa,
    congratulations, construction, construction_worker, construction_worker_man,
    construction_worker_woman, control_knobs, convenience_store, cook, cook_islands, cookie,
    cool, cop, copyright, coral, corn, costa_rica, cote_divoire, couch_and_lamp, couple,
    couple_with_heart, couple_with_heart_man_man, couple_with_heart_woman_man,
    couple_with_heart_woman_woman, couplekiss, couplekiss_man_man, couplekiss_man_woman,
    couplekiss_woman_woman, cow, cow2, cowboy_hat_face, crab, crayon, credit_card,
    crescent_moon, cricket, cricket_game, croatia, crocodile, croissant, crossed_fingers,
    crossed_flags, crossed_swords, crown, crutch, cry, crying_cat_face, crystal_ball, cuba,
    cucumber, cup_with_straw, cupcake, cupid, curacao, curling_stone, curly_haired_man,
    curly_haired_woman, curly_loop, currency_exchange, curry, cursing_face, custard, customs,
    cut_of_meat, cyclone, cyprus, czech_republic, dagger, dancer, dancers, dancing_men,
    dancing_women, dango, dark_sunglasses, dart, dash, date, de, deaf_man, deaf_person,
    deaf_woman, deciduous_tree, deer, denmark, department_store, derelict_house, desert,
    desert_island, desktop_computer, detective, diamond_shape_with_a_dot_inside, diamonds,
    diego_garcia, disappointed, disappointed_relieved, disguised_face, diving_mask, diya_lamp,
    dizzy, dizzy_face, djibouti, dna, do_not_litter, dodo, dog, dog2, dollar, dolls, dolphin,
    dominica, dominican_republic, donkey, door, dotted_line_face, doughnut, dove, dragon,
    dragon_face, dress, dromedary_camel, drooling_face, drop_of_blood, droplet, drum, duck,
    dumpling, dvd, e-mail, eagle, ear, ear_of_rice, ear_with_hearing_aid, earth_africa,
    earth_americas, earth_asia, ecuador, egg, eggplant, egypt, eight, eight_pointed_black_star,
    eight_spoked_asterisk, eject_button, el_salvador, electric_plug, elephant, elevator, elf,
    elf_man, elf_woman, email, empty_nest, end, england, envelope, envelope_with_arrow,
    equatorial_guinea, eritrea, es, estonia, ethiopia, eu, euro, european_castle,
    european_post_office, european_union, evergreen_tree, exclamation, exploding_head,
    expressionless, eye, eye_speech_bubble, eyeglasses, eyes, face_exhaling,
    face_holding_back_tears, face_in_clouds, face_with_diagonal_mouth, face_with_head_bandage,
    face_with_peeking_eye, face_with_spiral_eyes, face_with_thermometer, facepalm, facepunch,
    factory, factory_worker, fairy, fairy_man, fairy_woman, falafel, falkland_islands,
    fallen_leaf, family, family_man_boy, family_man_boy_boy, family_man_girl,
    family_man_girl_boy, family_man_girl_girl, family_man_man_boy, family_man_man_boy_boy,
    family_man_man_girl, family_man_man_girl_boy, family_man_man_girl_girl,
    family_man_woman_boy, family_man_woman_boy_boy, family_man_woman_girl,
    family_man_woman_girl_boy, family_man_woman_girl_girl, family_woman_boy,
    family_woman_boy_boy, family_woman_girl, family_woman_girl_boy, family_woman_girl_girl,
    family_woman_woman_boy, family_woman_woman_boy_boy, family_woman_woman_girl,
    family_woman_woman_girl_boy, family_woman_woman_girl_girl, farmer, faroe_islands,
    fast_forward, fax, fearful, feather, feet, female_detective, female_sign, ferris_wheel,
    ferry, field_hockey, fiji, file_cabinet, file_folder, film_projector, film_strip, finland,
    fire, fire_engine, fire_extinguisher, firecracker, firefighter, fireworks,
    first_quarter_moon, first_quarter_moon_with_face, fish, fish_cake, fishing_pole_and_fish,
    fist, fist_left, fist_oncoming, fist_raised, fist_right, five, flags, flamingo, flashlight,
    flat_shoe, flatbread, fleur_de_lis, flight_arrival, flight_departure, flipper, floppy_disk,
    flower_playing_cards, flushed, flute, fly, flying_disc, flying_saucer, fog, foggy,
    folding_hand_fan, fondue, foot, football, footprints, fork_and_knife, fortune_cookie,
    fountain, fountain_pen, four, four_leaf_clover, fox_face, fr, framed_picture, free,
    french_guiana, french_polynesia, french_southern_territories, fried_egg, fried_shrimp,
    fries, frog, frowning, frowning_face, frowning_man, frowning_person, frowning_woman, fu,
    fuelpump, full_moon, full_moon_with_face, funeral_urn, gabon, gambia, game_die, garlic, gb,
    gear, gem, gemini, genie, genie_man, genie_woman, georgia, ghana, ghost, gibraltar, gift,
    gift_heart, ginger_root, giraffe, girl, globe_with_meridians, gloves, goal_net, goat,
    goggles, golf, golfing, golfing_man, golfing_woman, goose, gorilla, grapes, greece,
    green_apple, green_book, green_circle, green_heart, green_salad, green_square, greenland,
    grenada, grey_exclamation, grey_heart, grey_question, grimacing, grin, grinning, guadeloupe,
    guam, guard, guardsman, guardswoman, guatemala, guernsey, guide_dog, guinea, guinea_bissau,
    guitar, gun, guyana, hair_pick, haircut, haircut_man, haircut_woman, haiti, hamburger,
    hammer, hammer_and_pick, hammer_and_wrench, hamsa, hamster, hand, hand_over_mouth, handbag,
    handball_person, handshake, hankey, hash, hatched_chick, hatching_chick, headphones,
    headstone, health_worker, hear_no_evil, heard_mcdonald_islands, heart, heart_decoration,
    heart_eyes, heart_eyes_cat, heart_hands, heart_on_fire, heartbeat, heartpulse, hearts,
    heavy_check_mark, heavy_division_sign, heavy_dollar_sign, heavy_equals_sign,
    heavy_exclamation_mark, heavy_heart_exclamation, heavy_minus_sign, heavy_multiplication_x,
    heavy_plus_sign, hedgehog, helicopter, herb, hibiscus, high_brightness, high_heel,
    hiking_boot, hindu_temple, hippopotamus, hocho, hole, honduras, honey_pot, honeybee,
    hong_kong, hook, horse, horse_racing, hospital, hot_face, hot_pepper, hotdog, hotel,
    hotsprings, hourglass, hourglass_flowing_sand, house, house_with_garden, houses, hugs,
    hungary, hushed, hut, hyacinth, ice_cream, ice_cube, ice_hockey, ice_skate, icecream,
    iceland, id, identification_card, ideograph_advantage, imp, inbox_tray, incoming_envelope,
    index_pointing_at_the_viewer, india, indonesia, infinity, information_desk_person,
    information_source, innocent, interrobang, iphone, iran, iraq, ireland, isle_of_man, israel,
    it, izakaya_lantern, jack_o_lantern, jamaica, japan, japanese_castle, japanese_goblin,
    japanese_ogre, jar, jeans, jellyfish, jersey, jigsaw, jordan, joy, joy_cat, joystick, jp,
    judge, juggling_person, kaaba, kangaroo, kazakhstan, kenya, key, keyboard, keycap_ten,
    khanda, kick_scooter, kimono, kiribati, kiss, kissing, kissing_cat, kissing_closed_eyes,
    kissing_heart, kissing_smiling_eyes, kite, kiwi_fruit, kneeling_man, kneeling_person,
    kneeling_woman, knife, knot, koala, koko, kosovo, kr, kuwait, kyrgyzstan, lab_coat, label,
    lacrosse, ladder, lady_beetle, lantern, laos, large_blue_circle, large_blue_diamond,
    large_orange_diamond, last_quarter_moon, last_quarter_moon_with_face, latin_cross, latvia,
    laughing, leafy_green, leaves, lebanon, ledger, left_luggage, left_right_arrow,
    left_speech_bubble, leftwards_arrow_with_hook, leftwards_hand, leftwards_pushing_hand, leg,
    lemon, leo, leopard, lesotho, level_slider, liberia, libra, libya, liechtenstein,
    light_blue_heart, light_rail, link, lion, lips, lipstick, lithuania, lizard, llama, lobster,
    lock, lock_with_ink_pen, lollipop, long_drum, loop, lotion_bottle, lotus, lotus_position,
    lotus_position_man, lotus_position_woman, loud_sound, loudspeaker, love_hotel, love_letter,
    love_you_gesture, low_battery, low_brightness, luggage, lungs, luxembourg, lying_face,
    macau, macedonia, madagascar, mag, mag_right, mage, mage_man, mage_woman, magic_wand,
    magnet, mahjong, mailbox, mailbox_closed, mailbox_with_mail, mailbox_with_no_mail, malawi,
    malaysia, maldives, male_detective, male_sign, mali, malta, mammoth, man, man_artist,
    man_astronaut, man_beard, man_cartwheeling, man_cook, man_dancing, man_facepalming,
    man_factory_worker, man_farmer, man_feeding_baby, man_firefighter, man_health_worker,
    man_in_manual_wheelchair, man_in_motorized_wheelchair, man_in_tuxedo, man_judge,
    man_juggling, man_mechanic, man_office_worker, man_pilot, man_playing_handball,
    man_playing_water_polo, man_scientist, man_shrugging, man_singer, man_student, man_teacher,
    man_technologist, man_with_gua_pi_mao, man_with_probing_cane, man_with_turban,
    man_with_veil, mandarin, mango, mans_shoe, mantelpiece_clock, manual_wheelchair, maple_leaf,
    maracas, marshall_islands, martial_arts_uniform, martinique, mask, massage, massage_man,
    massage_woman, mate, mauritania, mauritius, mayotte, meat_on_bone, mechanic, mechanical_arm,
    mechanical_leg, medal_military, medal_sports, medical_symbol, mega, melon, melting_face,
    memo, men_wrestling, mending_heart, menorah, mens, mermaid, merman, merperson, metal, metro,
    mexico, microbe, micronesia, microphone, microscope, middle_finger, military_helmet,
    milk_glass, milky_way, minibus, minidisc, mirror, mirror_ball, mobile_phone_off, moldova,
    monaco, money_mouth_face, money_with_wings, moneybag, mongolia, monkey, monkey_face,
    monocle_face, monorail, montenegro, montserrat, moon, moon_cake, moose, morocco,
    mortar_board, mosque, mosquito, motor_boat, motor_scooter, motorcycle, motorized_wheelchair,
    motorway, mount_fuji, mountain, mountain_bicyclist, mountain_biking_man,
    mountain_biking_woman, mountain_cableway, mountain_railway, mountain_snow, mouse, mouse2,
    mouse_trap, movie_camera, moyai, mozambique, mrs_claus, muscle, mushroom, musical_keyboard,
    musical_note, musical_score, mute, mx_claus, myanmar, nail_care, name_badge, namibia,
    national_park, nauru, nauseated_face, nazar_amulet, necktie, negative_squared_cross_mark,
    nepal, nerd_face, nest_with_eggs, nesting_dolls, netherlands, neutral_face, new,
    new_caledonia, new_moon, new_moon_with_face, new_zealand, newspaper, newspaper_roll,
    next_track_button, ng, ng_man, ng_woman, nicaragua, niger, nigeria, night_with_stars, nine,
    ninja, niue, no_bell, no_bicycles, no_entry, no_entry_sign, no_good, no_good_man,
    no_good_woman, no_mobile_phones, no_mouth, no_pedestrians, no_smoking, non-potable_water,
    norfolk_island, north_korea, northern_mariana_islands, norway, nose, notebook,
    notebook_with_decorative_cover, notes, nut_and_bolt, o2, ocean, octopus, oden, office,
    office_worker, oil_drum, ok, ok_hand, ok_man, ok_person, ok_woman, old_key, older_adult,
    older_man, older_woman, olive, om, oman, on, oncoming_automobile, oncoming_bus,
    oncoming_police_car, oncoming_taxi, one, one_piece_swimsuit, onion, open_book,
    open_file_folder, open_hands, open_mouth, open_umbrella, ophiuchus, orange, orange_book,
    orange_circle, orange_heart, orange_square, orangutan, orthodox_cross, otter, outbox_tray,
    owl, ox, oyster, package, page_facing_up, page_with_curl, pager, paintbrush, pakistan,
    palau, palestinian_territories, palm_down_hand, palm_tree, palm_up_hand, palms_up_together,
    panama, pancakes, panda_face, paperclip, paperclips, papua_new_guinea, parachute, paraguay,
    parasol_on_ground, parking, parrot, part_alternation_mark, partly_sunny, partying_face,
    passenger_ship, passport_control, pause_button, paw_prints, pea_pod, peace_symbol, peach,
    peacock, peanuts, pear, pen, pencil, pencil2, penguin, pensive, people_holding_hands,
    people_hugging, performing_arts, persevere, person_bald, person_curly_hair,
    person_feeding_baby, person_fencing, person_in_manual_wheelchair,
    person_in_motorized_wheelchair, person_in_tuxedo, person_red_hair, person_white_hair,
    person_with_crown, person_with_probing_cane, person_with_turban, person_with_veil, peru,
    petri_dish, philippines, phone, pick, pickup_truck, pie, pig, pig2, pig_nose, pill, pilot,
    pinata, pinched_fingers, pinching_hand, pineapple, ping_pong, pink_heart, pirate_flag,
    pisces, pitcairn_islands, pizza, placard, place_of_worship, plate_with_cutlery,
    play_or_pause_button, playground_slide, pleading_face, plunger, point_down, point_left,
    point_right, point_up, point_up_2, poland, polar_bear, police_car, police_officer,
    policeman, policewoman, poodle, poop, popcorn, portugal, post_office, postal_horn, postbox,
    potable_water, potato, potted_plant, pouch, poultry_leg, pound, pouring_liquid, pout,
    pouting_cat, pouting_face, pouting_man, pouting_woman, pray, prayer_beads, pregnant_man,
    pregnant_person, pregnant_woman, pretzel, previous_track_button, prince, princess, printer,
    probing_cane, puerto_rico, punch, purple_circle, purple_heart, purple_square, purse,
    pushpin, put_litter_in_its_place, qatar, question, rabbit, rabbit2, raccoon, racehorse,
    racing_car, radio, radio_button, radioactive, rage, railway_car, railway_track, rainbow,
    rainbow_flag, raised_back_of_hand, raised_eyebrow, raised_hand,
    raised_hand_with_fingers_splayed, raised_hands, raising_hand, raising_hand_man,
    raising_hand_woman, ram, ramen, rat, razor, receipt, record_button, recycle, red_car,
    red_circle, red_envelope, red_haired_man, red_haired_woman, red_square, registered, relaxed,
    relieved, reminder_ribbon, repeat, repeat_one, rescue_worker_helmet, restroom, reunion,
    revolving_hearts, rewind, rhinoceros, ribbon, rice, rice_ball, rice_cracker, rice_scene,
    right_anger_bubble, rightwards_hand, rightwards_pushing_hand, ring, ring_buoy,
    ringed_planet, robot, rock, rocket, rofl, roll_eyes, roll_of_paper, roller_coaster,
    roller_skate, romania, rooster, rose, rosette, rotating_light, round_pushpin, rowboat,
    rowing_man, rowing_woman, ru, rugby_football, runner, running, running_man,
    running_shirt_with_sash, running_woman, rwanda, sa, safety_pin, safety_vest, sagittarius,
    sailboat, sake, salt, saluting_face, samoa, san_marino, sandal, sandwich, santa,
    sao_tome_principe, sari, sassy_man, sassy_woman, satellite, satisfied, saudi_arabia,
    sauna_man, sauna_person, sauna_woman, sauropod, saxophone, scarf, school, school_satchel,
    scientist, scissors, scorpion, scorpius, scotland, scream, scream_cat, screwdriver, scroll,
    seal, seat, secret, see_no_evil, seedling, selfie, senegal, serbia, service_dog, seven,
    sewing_needle, seychelles, shaking_face, shallow_pan_of_food, shamrock, shark, shaved_ice,
    sheep, shell, shield, shinto_shrine, ship, shirt, shit, shoe, shopping, shopping_cart,
    shorts, shower, shrimp, shrug, shushing_face, sierra_leone, signal_strength, singapore,
    singer, sint_maarten, six, six_pointed_star, skateboard, ski, skier, skull,
    skull_and_crossbones, skunk, sled, sleeping, sleeping_bed, sleepy, slightly_frowning_face,
    slightly_smiling_face, slot_machine, sloth, slovakia, slovenia, small_airplane,
    small_blue_diamond, small_orange_diamond, small_red_triangle, small_red_triangle_down,
    smile, smile_cat, smiley, smiley_cat, smiling_face_with_tear,
    smiling_face_with_three_hearts, smiling_imp, smirk, smirk_cat, smoking, snail, snake,
    sneezing_face, snowboarder, snowflake, snowman, snowman_with_snow, soap, sob, soccer, socks,
    softball, solomon_islands, somalia, soon, sos, sound, south_africa, south_sudan,
    space_invader, spades, spaghetti, sparkle, sparkler, sparkles, sparkling_heart,
    speak_no_evil, speaker, speaking_head, speech_balloon, speedboat, spider, spider_web,
    spiral_calendar, spiral_notepad, sponge, spoon, squid, sri_lanka, st_barthelemy, st_helena,
    st_kitts_nevis, st_lucia, st_martin, st_pierre_miquelon, st_vincent_grenadines, stadium,
    standing_man, standing_person, standing_woman, star, star2, star_and_crescent,
    star_of_david, star_struck, stars, station, statue_of_liberty, steam_locomotive,
    stethoscope, stew, stop_button, stop_sign, stopwatch, straight_ruler, strawberry,
    stuck_out_tongue, stuck_out_tongue_closed_eyes, stuck_out_tongue_winking_eye, student,
    studio_microphone, stuffed_flatbread, sudan, sun_behind_large_cloud, sun_behind_rain_cloud,
    sun_behind_small_cloud, sun_with_face, sunflower, sunglasses, sunny, sunrise,
    sunrise_over_mountains, superhero, superhero_man, superhero_woman, supervillain,
    supervillain_man, supervillain_woman, surfer, surfing_man, surfing_woman, suriname, sushi,
    suspension_railway, svalbard_jan_mayen, swan, swaziland, sweat, sweat_drops, sweat_smile,
    sweden, sweet_potato, swim_brief, swimmer, swimming_man, swimming_woman, switzerland,
    symbols, synagogue, syria, syringe, t-rex, taco, tada, taiwan, tajikistan, takeout_box,
    tamale, tanabata_tree, tangerine, tanzania, taurus, taxi, tea, teacher, teapot,
    technologist, teddy_bear, telephone, telephone_receiver, telescope, tennis, tent, test_tube,
    thailand, thermometer, thinking, thong_sandal, thought_balloon, thread, three, thumbsdown,
    thumbsup, ticket, tickets, tiger, tiger2, timer_clock, timor_leste, tipping_hand_man,
    tipping_hand_person, tipping_hand_woman, tired_face, tm, togo, toilet, tokelau, tokyo_tower,
    tomato, tonga, tongue, toolbox, tooth, toothbrush, top, tophat, tornado, tr, trackball,
    tractor, traffic_light, train, train2, tram, transgender_flag, transgender_symbol,
    triangular_flag_on_post, triangular_ruler, trident, trinidad_tobago, tristan_da_cunha,
    triumph, troll, trolleybus, trophy, tropical_drink, tropical_fish, truck, trumpet, tshirt,
    tulip, tumbler_glass, tunisia, turkey, turkmenistan, turks_caicos_islands, turtle, tuvalu,
    tv, twisted_rightwards_arrows, two, two_hearts, two_men_holding_hands,
    two_women_holding_hands, u5272, u5408, u55b6, u6307, u6708, u6709, u6e80, u7121, u7533,
    u7981, u7a7a, uganda, uk, ukraine, umbrella, unamused, underage, unicorn,
    united_arab_emirates, united_nations, unlock, up, upside_down_face, uruguay, us,
    us_outlying_islands, us_virgin_islands, uzbekistan, vampire, vampire_man, vampire_woman,
    vanuatu, vatican_city, venezuela, vertical_traffic_light, vhs, vibration_mode, video_camera,
    video_game, vietnam, violin, virgo, volcano, volleyball, vomiting_face, vs, vulcan_salute,
    waffle, wales, walking, walking_man, walking_woman, wallis_futuna, waning_crescent_moon,
    waning_gibbous_moon, warning, wastebasket, watch, water_buffalo, water_polo, watermelon,
    wave, wavy_dash, waxing_crescent_moon, waxing_gibbous_moon, wc, weary, wedding,
    weight_lifting, weight_lifting_man, weight_lifting_woman, western_sahara, whale, whale2,
    wheel, wheel_of_dharma, wheelchair, white_check_mark, white_circle, white_flag,
    white_flower, white_haired_man, white_haired_woman, white_heart, white_large_square,
    white_medium_small_square, white_medium_square, white_small_square, white_square_button,
    wilted_flower, wind_chime, wind_face, window, wine_glass, wing, wink, wireless, wolf, woman,
    woman_artist, woman_astronaut, woman_beard, woman_cartwheeling, woman_cook, woman_dancing,
    woman_facepalming, woman_factory_worker, woman_farmer, woman_feeding_baby,
    woman_firefighter, woman_health_worker, woman_in_manual_wheelchair,
    woman_in_motorized_wheelchair, woman_in_tuxedo, woman_judge, woman_juggling, woman_mechanic,
    woman_office_worker, woman_pilot, woman_playing_handball, woman_playing_water_polo,
    woman_scientist, woman_shrugging, woman_singer, woman_student, woman_teacher,
    woman_technologist, woman_with_headscarf, woman_with_probing_cane, woman_with_turban,
    woman_with_veil, womans_clothes, womans_hat, women_wrestling, womens, wood, woozy_face,
    world_map, worm, worried, wrench, wrestling, writing_hand, x_ray, yarn, yawning_face,
    yellow_circle, yellow_heart, yellow_square, yemen, yen, yin_yang, yo_yo, yum, zambia,
    zany_face, zap, zebra, zero, zimbabwe, zipper_mouth_face, zombie, zombie_man, zombie_woman,
    zzz
    }'::text[]
    -- reserved:end
  )
$function$;

-- Is `:name:` a live emoji of this workspace?
CREATE OR REPLACE FUNCTION public.chat__emoji_live(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_custom_emoji e
     WHERE e.workspace_id = p_workspace_id
       AND e.name = btrim(p_key, ':')
       AND e.deleted_at IS NULL)
$function$;

-- ── 4. Storage: the chat-emoji bucket ──────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, type)
VALUES ('chat-emoji', 'chat-emoji', false, 262144,
        ARRAY['image/png', 'image/gif', 'image/webp'], 'STANDARD')
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 262144,
      allowed_mime_types = ARRAY['image/png', 'image/gif', 'image/webp'];

-- An upload slot: the server mints the id the two images are stored under,
-- for one person in one workspace, for an hour. Uploads go only into a slot
-- of your own, and an emoji is made only from the images you uploaded into
-- it, so no path can be taken or prepared by anyone else. Server only.
CREATE TABLE IF NOT EXISTS public.chat_custom_emoji_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS chat_custom_emoji_uploads_uploader
  ON public.chat_custom_emoji_uploads (uploader_id, created_at);
ALTER TABLE public.chat_custom_emoji_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_custom_emoji_uploads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_custom_emoji_uploads TO service_role;

-- The slot an object path names (`<workspace>/<slot>.<ext>` or
-- `<workspace>/<slot>.poster.png`), or null when it isn't an emoji path
-- (checked before the cast, so a stray name can't make a policy throw).
CREATE OR REPLACE FUNCTION public.chat_emoji__path_slot(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|gif|webp|poster\.png)$'
    THEN substring(p_name FROM 38 FOR 36)::uuid
  END
$function$;

CREATE OR REPLACE FUNCTION public.chat_emoji__path_workspace(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE WHEN public.chat_emoji__path_slot(p_name) IS NOT NULL
              THEN split_part(p_name, '/', 1)::uuid END
$function$;

-- Storage policies' checks, about the caller only (policies run them as the
-- signed-in person, so they're granted to authenticated). Uploading needs an
-- open slot of your own in that very workspace folder, and still the switch
-- and the plan.
CREATE OR REPLACE FUNCTION public.chat_emoji__may_upload(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ws uuid := public.chat_emoji__path_workspace(p_name);
  v_slot uuid := public.chat_emoji__path_slot(p_name);
BEGIN
  RETURN v_ws IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.chat_custom_emoji_uploads u
                  WHERE u.id = v_slot AND u.workspace_id = v_ws AND u.uploader_id = auth.uid()
                    AND u.used_at IS NULL AND u.created_at > now() - interval '1 hour')
     AND public.chat_is_workspace_member(v_ws, auth.uid())
     AND public.chat_workspace_enabled(v_ws)
     AND public.chat_has_cap(v_ws, auth.uid(), 'add_emoji');
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_emoji__may_read(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.chat_emoji__readable(public.chat_emoji__path_workspace(p_name))
$function$;

-- Insert and read only: nobody overwrites or deletes an emoji's image (no
-- UPDATE or DELETE rule; removing an emoji is the op's soft delete).
DROP POLICY IF EXISTS chat_emoji_upload ON storage.objects;
CREATE POLICY chat_emoji_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-emoji' AND public.chat_emoji__may_upload(name));
DROP POLICY IF EXISTS chat_emoji_read ON storage.objects;
CREATE POLICY chat_emoji_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-emoji' AND public.chat_emoji__may_read(name));

-- ── 5. The ops ─────────────────────────────────────────────────────────────

-- A slot to upload into (at most 20 open per person an hour).
CREATE OR REPLACE FUNCTION public.chat_op_custom_emoji_begin(p_workspace_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_id uuid;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  IF NOT public.chat_has_cap(p_workspace_id, v_me, 'add_emoji') THEN
    RAISE EXCEPTION 'Your role can''t add custom emoji.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.chat_custom_emoji_uploads u
       WHERE u.uploader_id = v_me AND u.used_at IS NULL
         AND u.created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many emoji uploads at once. Try again in a while.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.chat_custom_emoji_uploads (workspace_id, uploader_id)
  VALUES (p_workspace_id, v_me)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_custom_emoji_add(
  p_upload_id uuid,
  p_name text,
  p_mime text,
  p_width integer,
  p_height integer,
  p_bytes integer,
  p_animated boolean
)
RETURNS public.chat_custom_emoji
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_name text := btrim(lower(btrim(coalesce(p_name, ''))), ':');
  v_slot public.chat_custom_emoji_uploads;
  v_ws uuid;
  v_ext text;
  v_path text;
  v_poster_path text;
  v_obj storage.objects;
  v_poster storage.objects;
  v_row public.chat_custom_emoji;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.' USING ERRCODE = '42501';
  END IF;
  -- Only your own open slot (someone else's answers as a missing one).
  SELECT * INTO v_slot FROM public.chat_custom_emoji_uploads
   WHERE id = p_upload_id AND uploader_id = v_me FOR UPDATE;
  IF v_slot.id IS NULL OR v_slot.used_at IS NOT NULL OR v_slot.created_at <= now() - interval '1 hour' THEN
    RAISE EXCEPTION 'Upload the image first.' USING ERRCODE = '22023';
  END IF;
  v_ws := v_slot.workspace_id;
  PERFORM public.chat_op__guard(v_ws);
  IF NOT public.chat_has_cap(v_ws, v_me, 'add_emoji') THEN
    RAISE EXCEPTION 'Your role can''t add custom emoji.' USING ERRCODE = '42501';
  END IF;

  IF v_name !~ '^(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{2,32}$' THEN
    RAISE EXCEPTION 'A name is 2 to 32 lowercase letters, digits, - or _, with at least one letter.'
      USING ERRCODE = '22023';
  END IF;
  IF public.chat__emoji_name_reserved(v_name) THEN
    RAISE EXCEPTION ':%: is a standard emoji. Pick another name.', v_name USING ERRCODE = '22023';
  END IF;

  v_ext := CASE p_mime WHEN 'image/png' THEN 'png' WHEN 'image/gif' THEN 'gif'
                       WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL THEN
    RAISE EXCEPTION 'Use a PNG, GIF or WebP image.' USING ERRCODE = '22023';
  END IF;
  IF p_width IS NULL OR p_height IS NULL OR p_width NOT BETWEEN 1 AND 128 OR p_height NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'A custom emoji is at most 128 by 128 pixels.' USING ERRCODE = '22023';
  END IF;
  IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 262144 THEN
    RAISE EXCEPTION 'A custom emoji is at most 256 KB.' USING ERRCODE = '22023';
  END IF;
  IF p_animated IS NULL THEN
    RAISE EXCEPTION 'Say whether the emoji is animated.' USING ERRCODE = '22023';
  END IF;

  -- The paths come from the slot, never from the caller: the image under the
  -- extension its type names, and its still frame beside it.
  v_path := v_ws::text || '/' || v_slot.id::text || '.' || v_ext;
  v_poster_path := v_ws::text || '/' || v_slot.id::text || '.poster.png';
  SELECT * INTO v_obj FROM storage.objects o
   WHERE o.bucket_id = 'chat-emoji' AND o.name = v_path;
  SELECT * INTO v_poster FROM storage.objects o
   WHERE o.bucket_id = 'chat-emoji' AND o.name = v_poster_path;
  -- Both uploaded, by you.
  IF v_obj.id IS NULL OR v_poster.id IS NULL
     OR coalesce(v_obj.owner_id, v_obj.owner::text) IS DISTINCT FROM v_me::text
     OR coalesce(v_poster.owner_id, v_poster.owner::text) IS DISTINCT FROM v_me::text THEN
    RAISE EXCEPTION 'Upload the image first.' USING ERRCODE = '22023';
  END IF;
  -- Stored with the type and size described.
  IF v_obj.metadata ->> 'mimetype' IS DISTINCT FROM p_mime
     OR (v_obj.metadata ->> 'size') IS NULL OR (v_obj.metadata ->> 'size')::bigint <> p_bytes THEN
    RAISE EXCEPTION 'The uploaded image isn''t the one described.' USING ERRCODE = '22023';
  END IF;
  IF v_poster.metadata ->> 'mimetype' IS DISTINCT FROM 'image/png'
     OR (v_poster.metadata ->> 'size') IS NULL
     OR (v_poster.metadata ->> 'size')::bigint NOT BETWEEN 1 AND 262144 THEN
    RAISE EXCEPTION 'The still frame must be a PNG of at most 256 KB.' USING ERRCODE = '22023';
  END IF;

  -- One add at a time per workspace, so the 500 and the name hold.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat_custom_emoji:' || v_ws::text, 0));
  IF (SELECT count(*) FROM public.chat_custom_emoji e
       WHERE e.workspace_id = v_ws AND e.deleted_at IS NULL) >= 500 THEN
    RAISE EXCEPTION 'This workspace has 500 custom emoji, the most it can hold. Remove one first.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_custom_emoji e
              WHERE e.workspace_id = v_ws AND e.name = v_name AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'There''s already an emoji called :%:.', v_name USING ERRCODE = '23505';
  END IF;

  UPDATE public.chat_custom_emoji_uploads SET used_at = now() WHERE id = v_slot.id;
  INSERT INTO public.chat_custom_emoji (
    workspace_id, name, storage_path, poster_path, mime, width, height, bytes, animated, created_by)
  VALUES (v_ws, v_name, v_path, v_poster_path, p_mime, p_width, p_height, p_bytes, p_animated, v_me)
  RETURNING * INTO v_row;
  PERFORM public.module_activity_log(v_ws, 'chat', 'chat_custom_emoji', v_row.id,
    'chat.emoji_add', jsonb_build_object('name', v_row.name));
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_custom_emoji_remove(p_id uuid)
RETURNS public.chat_custom_emoji
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_row public.chat_custom_emoji;
BEGIN
  SELECT * INTO v_row FROM public.chat_custom_emoji WHERE id = p_id FOR UPDATE;
  -- Someone outside the workspace gets the same answer as for a missing one.
  IF v_row.id IS NULL OR v_me IS NULL
     OR NOT public.chat_is_workspace_member(v_row.workspace_id, v_me) THEN
    RAISE EXCEPTION 'That emoji no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__guard(v_row.workspace_id);
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  IF v_row.created_by IS DISTINCT FROM v_me AND NOT public.chat_is_workspace_admin(v_row.workspace_id) THEN
    RAISE EXCEPTION 'Only whoever added it or an admin can remove it.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.chat_custom_emoji SET deleted_at = now() WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM public.module_activity_log(v_row.workspace_id, 'chat', 'chat_custom_emoji', v_row.id,
    'chat.emoji_remove', jsonb_build_object('name', v_row.name));
  RETURN v_row;
END;
$function$;

-- ── 6. Reactions take a live `:name:` ──────────────────────────────────────

SELECT pg_temp.recut(
  'public.chat_op_react(uuid, text, boolean)'::regprocedure,
  $old$  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message takes reactions.' USING ERRCODE = '22023';
  END IF;
$old$,
  $new$  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message takes reactions.' USING ERRCODE = '22023';
  END IF;
  -- CV-20: a custom emoji is added only while it's live in this workspace.
  IF p_on AND p_key ~ public.reactions__custom_key_pattern()
     AND NOT public.chat__emoji_live(v_msg.workspace_id, p_key) THEN
    RAISE EXCEPTION 'That emoji isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
$new$);

SELECT pg_temp.recut(
  'public.comments_op_react(uuid, text, boolean)'::regprocedure,
  $old$  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;
$old$,
  $new$  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;
  -- CV-20: a custom emoji is added only while it's live in this workspace.
  IF coalesce(p_on, true) AND p_reaction ~ public.reactions__custom_key_pattern()
     AND NOT public.chat__emoji_live(v.workspace_id, p_reaction) THEN
    RAISE EXCEPTION 'That emoji isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
$new$);

-- ── 7. Account erasure ─────────────────────────────────────────────────────

SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  v_saved_statuses integer;
$old$,
  $new$  v_saved_statuses integer;
  v_custom_emoji integer;
$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$old$,
  $new$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  -- CV-20: the custom emoji they added stay with the workspace, unattributed.
  SELECT count(*) INTO v_custom_emoji FROM public.chat_custom_emoji x WHERE x.created_by = p_user;
$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$'saved_statuses_deleted', v_saved_statuses$old$,
  $new$'saved_statuses_deleted', v_saved_statuses,
    'custom_emoji_unattributed', v_custom_emoji$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$old$,
  $new$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  UPDATE public.chat_custom_emoji x SET created_by = NULL WHERE x.created_by = p_user;
  DELETE FROM public.chat_custom_emoji_uploads x WHERE x.uploader_id = p_user;
$new$);

-- ── 8. Published ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_custom_emoji'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_custom_emoji;
  END IF;
END;
$$;

-- ── 9. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Server only.
  FOREACH fn IN ARRAY ARRAY[
    'chat__emoji_name_reserved(text)',
    'chat__emoji_live(uuid, text)',
    'chat_emoji__path_workspace(text)',
    'chat_emoji__path_slot(text)',
    'chat_has_cap(uuid, uuid, text)',
    'share_seed_workspace()',
    'account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People (signed in; keys are refused inside). The storage policies' checks
  -- run as the signed-in person and answer only about them. The key checks are
  -- pure (the app may call them).
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_custom_emoji_begin(uuid)',
    'chat_op_custom_emoji_add(uuid, text, text, integer, integer, integer, boolean)',
    'chat_op_custom_emoji_remove(uuid)',
    'chat_emoji__may_upload(text)',
    'chat_emoji__may_read(text)',
    'chat_emoji__readable(uuid)',
    'chat_caps_set(uuid, text, jsonb)',
    'chat_op_react(uuid, text, boolean)',
    'comments_op_react(uuid, text, boolean)',
    'reactions__key_ok(text)',
    'reactions__key_canonical(text)',
    'reactions__custom_key_pattern()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

-- ── 10. Assertions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.chat_custom_emoji', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_custom_emoji', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.chat_custom_emoji', 'DELETE')
     OR has_table_privilege('anon', 'public.chat_custom_emoji', 'SELECT') THEN
    RAISE EXCEPTION 'chat_custom_emoji is written only through the ops.';
  END IF;
  IF has_table_privilege('authenticated', 'public.chat_custom_emoji_uploads', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_custom_emoji_uploads', 'INSERT')
     OR has_table_privilege('anon', 'public.chat_custom_emoji_uploads', 'SELECT') THEN
    RAISE EXCEPTION 'Upload slots are the server''s only.';
  END IF;
  -- Nobody overwrites or deletes an emoji image (only insert and read rules).
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND cmd IN ('UPDATE', 'DELETE', 'ALL')
                AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%chat-emoji%') THEN
    RAISE EXCEPTION 'An emoji image must not be changeable or deletable by a person.';
  END IF;
  IF has_function_privilege('anon', 'public.chat_op_custom_emoji_add(uuid, text, text, integer, integer, integer, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__emoji_live(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat_has_cap(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A server-only function is open to callers.';
  END IF;
  IF NOT public.reactions__key_ok(':shipit:') OR public.reactions__key_ok(':Shipit:')
     OR public.reactions__key_canonical(':v2:') <> ':v2:' THEN
    RAISE EXCEPTION 'The reaction key doesn''t take custom emoji as expected.';
  END IF;
  IF (SELECT replica_identity FROM (SELECT relreplident AS replica_identity FROM pg_class
       WHERE oid = 'public.chat_custom_emoji'::regclass) x) <> 'd' THEN
    RAISE EXCEPTION 'chat_custom_emoji must be keyed by its own id for Realtime.';
  END IF;
END;
$$;
