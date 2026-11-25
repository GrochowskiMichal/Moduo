// /security's map (components/security/Map.astro). "Follow" picks one thing: its places and wires
// light and the rest step back, and a dot runs its path once, wire by wire, in the direction the
// thing travels. The email is followed when the map first comes into view. Without motion the path
// still lights; the dot stays home.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../../engine";

export function startSecurity() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="security"] [data-smap]');
    if (!root) return;
    const map = root.querySelector<HTMLElement>(".smap")!;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-follow]")];
    const order = [...map.querySelectorAll<HTMLElement>("[data-place]")].map(
      (el) => el.dataset.place!,
    );
    const wires = [...map.querySelectorAll<HTMLElement>("[data-wire]")];
    const reduce = prefersReducedMotion();
    let run: gsap.core.Timeline | null = null;

    const travel = (id: string) => {
      run?.kill();
      wires.forEach((w) => gsap.set(w.querySelector(".smap__dot"), { autoAlpha: 0 }));
      if (reduce) return;
      // The thing's places, in the order it travels (data: map.things[].places).
      const places = buttons.find((b) => b.dataset.follow === id)?.dataset.path?.split(" ") ?? [];
      run = gsap.timeline();
      for (let k = 0; k < places.length - 1; k++) {
        const a = order.indexOf(places[k]);
        const b = order.indexOf(places[k + 1]);
        const wire = wires[Math.min(a, b)];
        const dot = wire?.querySelector<HTMLElement>(".smap__dot");
        if (!wire || !dot) continue;
        const h = wire.offsetHeight - 9;
        const down = b > a;
        run
          .set(dot, { y: down ? 0 : h, autoAlpha: 0 })
          .to(dot, { autoAlpha: 1, duration: 0.18 })
          .to(dot, { y: down ? h : 0, duration: 0.9, ease: ease.inOut }, "<")
          .to(dot, { autoAlpha: 0, duration: 0.25 }, ">-0.1");
      }
    };

    const follow = (id: string, play = true) => {
      map.dataset.follow = id;
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.follow === id)));
      if (play) travel(id);
    };

    const onClick = (e: MouseEvent) => {
      const b = (e.currentTarget as HTMLButtonElement).dataset.follow!;
      follow(b);
    };
    buttons.forEach((b) => b.addEventListener("click", onClick));

    // The email is the first thing followed: lit at once, run when the map is in view.
    follow("email", false);
    const st = ScrollTrigger.create({
      trigger: map,
      start: "top 70%",
      once: true,
      onEnter: () => travel(map.dataset.follow ?? "email"),
    });

    return () => {
      run?.kill();
      st.kill();
      buttons.forEach((b) => b.removeEventListener("click", onClick));
      delete map.dataset.follow;
    };
  });
}
