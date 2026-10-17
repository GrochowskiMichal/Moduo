// What a pushed notice shows (TV-D12), shared by the push service worker
// (public/push-sw.js, through importScripts) and its unit test. A notice shows
// its words only to the person signed in on this browser (the page tells the
// worker who that is); for anyone else, or nobody, it's a plain line with no
// task or message in it. Only a path inside Moduo is ever opened. A chat
// notice (CV-6b) carries the server's "Sofia Ortiz · #plans · Acme" title and
// text, cut to push-send's lengths; its tag ("chat:<conversation>") makes a
// burst replace the last notice.
((root) => {
  function pushDisplay(data, signedInUserId) {
    var d = data && typeof data === "object" ? data : {};
    var mine = typeof d.uid === "string" && d.uid !== "" && d.uid === signedInUserId;
    var url =
      typeof d.url === "string" && d.url.charAt(0) === "/" && d.url.charAt(1) !== "/" ? d.url : "/";
    if (!mine) {
      return {
        title: "Moduo",
        body: "You have a new notice. Sign in to see it.",
        url: "/",
        tag: "moduo-notice",
      };
    }
    var chat = typeof d.tag === "string" && d.tag.indexOf("chat:") === 0;
    return {
      title:
        typeof d.title === "string" && d.title
          ? d.title.slice(0, chat ? 120 : 80)
          : chat
            ? "New message"
            : "Reminder",
      body: typeof d.body === "string" ? d.body.slice(0, chat ? 160 : 120) : "",
      url: url,
      tag: typeof d.tag === "string" ? d.tag.slice(0, 80) : "moduo-notice",
    };
  }
  root.moduoPushDisplay = pushDisplay;
})(typeof self !== "undefined" ? self : globalThis);
