-- Chat v2 · the v1 → v2 text converter, `chat__v1_to_v2` (CV-1). It outlived
-- the one-shot conversion (dropped by …_drop_legacy_chat_fns.sql): the
-- connector's `chat_op_agent_post` and the body_text trigger still call it.
-- These are spike 4's 68 hand-made v1 bodies and the v2 text each must give,
-- moved here from the retired chat_convert.test.sql.

CREATE TABLE test.v1_pairs (fid text PRIMARY KEY, v1 text NOT NULL, v2 text NOT NULL);
INSERT INTO test.v1_pairs (fid, v1, v2) VALUES
  ('f01', 'Hey <@11111111-1111-4111-8111-111111111111> look', 'Hey moduo://person/11111111-1111-4111-8111-111111111111 look'),
  ('f02', '<@ABCDEF12-1111-4111-8111-111111111111>', 'moduo://person/abcdef12-1111-4111-8111-111111111111'),
  ('f03', '<!channel> standup moves', '@channel standup moves'),
  ('f04', 'hi<!channel>s', 'hi @channel s'),
  ('f05', 'Tracking <moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|Ship the onboarding checklist>', 'Tracking moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f06', '<moduo:note:d037b0b7-4125-415d-bef9-72662d6b58e6|a *b* `c` [d](e)>', 'moduo://note/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f07', 'Do we keep the _Friday_ demo?', 'Do we keep the *Friday* demo?'),
  ('f08', 'my_var_name and _x_y', 'my_var_name and _x_y'),
  ('f09', '*_x_*', '*x*'),
  ('f10', '** a ** b', ' **a**  b'),
  ('f11', '**_both_**', '***both***'),
  ('f12', '`<@11111111-1111-4111-8111-111111111111>` and `_x_`', '`<@11111111-1111-4111-8111-111111111111>` and `_x_`'),
  ('f13', '```
<!channel> _x_ **y**
```', '```
<!channel> _x_ **y**
```'),
  ('f14', 'see ```code``` here', 'see

```
code
```

 here'),
  ('f15', '```js
const a = 1;
```', '```js
const a = 1;
```'),
  ('f16', '2*3*4 = 24 and 5 * 3', '2\*3\*4 = 24 and 5 \* 3'),
  ('f17', 'a `` b', 'a \`\` b'),
  ('f18', '~5 min ~~ maybe', '\~5 min \~\~ maybe'),
  ('f19', 'C:\Users\me and \*', 'C:\\Users\\me and \\\*'),
  ('f20', 'moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6', 'moduo\://task/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f21', 'https://x.com/a_b_*c*', '[https://x.com/a_b_\*c\*](https://x.com/a_b_*c*)'),
  ('f22', 'Plan:
- one
- two', 'Plan:
- one
- two'),
  ('f23', '1. first
2. second', '1. first
2. second'),
  ('f24', '[docs](https://moduo.app)', '[docs](https://moduo.app)'),
  ('f25', '> quoted _it_
reply', '> quoted *it*
reply'),
  ('f26', 'nice :tada: at 10:30:45', 'nice :tada: at 10:30:45'),
  ('f27', '**Hey** <@11111111-1111-4111-8111-111111111111>, see <moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|X> by _Friday_ ~~not~~ `now` https://moduo.app.', '**Hey** moduo://person/11111111-1111-4111-8111-111111111111, see moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 by *Friday* ~~not~~ `now` https://moduo.app.'),
  ('f28', '_a
b_', '_a
b_'),
  ('f29', '~~a~~b~~c~~', '~~a~~b~~c~~'),
  ('f30', '# Title', '# Title'),
  ('f31', '_a*b_', '*a\*b*'),
  ('f32', 'Zażółć _gęślą_ **jaźń**', 'Zażółć *gęślą* **jaźń**'),
  ('f33', '  
', '  
'),
  ('f34', 'a <b> c <@not-a-uuid>', 'a <b> c <@not-a-uuid>'),
  ('f35', '```
never closed', '\`\`\`
never closed'),
  ('f36', '**run `make`**', '**run `make`**'),
  ('f37', '**open', '\*\*open'),
  ('f38', '**a**_b_', '**a***b*'),
  ('f39', '_a_**b**', '*a***b**'),
  ('f40', '**<!channel>** now', '**@channel** now'),
  ('f41', 'a
```
x
```
b', 'a

```
x
```

b'),
  ('f42', '*a* and *b c*', '*a* and *b c*'),
  ('f43', '~~ gone ~~ here', ' ~~gone~~  here'),
  ('f44', 'see <moduo:bucket:5abe4f3d-8b6c-4d7e-8fc0-6b7c8d9eafb0|Acme>!', 'see moduo://bucket/5abe4f3d-8b6c-4d7e-8fc0-6b7c8d9eafb0!'),
  ('f45', '> line one
> <!channel> line two', '> line one
> @channel line two'),
  ('f46', '```spacing: 12px
radius: 8px```', '```
spacing: 12px
radius: 8px
```'),
  ('f47', '```js 
x```', '```js
x
```'),
  ('f48', 'text ```a``` and ```b``` end', 'text

```
a
```

 and

```
b
```

 end'),
  ('f49', '**bold _and italic <@11111111-1111-4111-8111-111111111111>_**', '**bold *and italic moduo://person/11111111-1111-4111-8111-111111111111***'),
  ('f50', 'ping <!channel>, <!channel>!', 'ping @channel, @channel!'),
  ('f51', '**C:\Users\**', '**C:\\Users\\**'),
  ('f52', '_a\_', '*a\\*'),
  ('f53', '~~a\~~', '~~a\\~~'),
  ('f54', '**\**', '**\\**'),
  ('f55', '*a\*', '*a\\*'),
  ('f56', '`a``b`', '`ab`'),
  ('f57', '` a `', '`  a  `'),
  ('f58', '  > x', '  \> x'),
  ('f59', 'see https://x.com/a_ ok', 'see [https://x.com/a_](https://x.com/a_) ok'),
  ('f60', 'go https://x.com/a} ok', 'go [https://x.com/a}](https://x.com/a}) ok'),
  ('f61', 'xhttps://x.com/a', 'x[https://x.com/a](https://x.com/a)'),
  ('f62', 'https://en.wikipedia.org/wiki/Mars_(planet)', '[https://en.wikipedia.org/wiki/Mars_(planet](https://en.wikipedia.org/wiki/Mars_\(planet))'),
  ('f63', 'see https://x.com/[a] ok', 'see [https://x.com/\[a](https://x.com/[a)] ok'),
  ('f64', 'a
  > b', 'a
  \> b'),
  ('f65', '**bold https://x.com/a* x**', '**bold [https://x.com/a\*](https://x.com/a*) x**'),
  ('f66', 'hey**<!channel>**', 'hey **@channel**'),
  ('f67', 'a~~<!channel> now~~', 'a ~~@channel now~~'),
  ('f68', 'see https://x.com/?r=moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 ok', 'see https://x.com/?r=moduo\://task/d037b0b7-4125-415d-bef9-72662d6b58e6 ok')
;

DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(fid, ', ') INTO v_bad FROM test.v1_pairs WHERE public.chat__v1_to_v2(v1) IS DISTINCT FROM v2;
  PERFORM test.ok(v_bad IS NULL, 'converter: all 68 hand-made v1 bodies give spike 4''s v2 text', v_bad);
  PERFORM test.ok((SELECT count(*) FROM test.v1_pairs) = 68, 'the fixture holds all 68 pairs');
END;
$$;
