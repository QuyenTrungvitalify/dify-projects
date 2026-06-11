/* ============================================================
   icons.jsx — minimal stroke UI glyphs
   ============================================================ */
const _s = { width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
const Svg = (p) => React.createElement("svg", { viewBox: "0 0 24 24", ..._s, ...p });

const I = {
  chevron:  (p) => <Svg {...p}><path d="M9 6l6 6-6 6"/></Svg>,
  chevDown: (p) => <Svg {...p}><path d="M6 9l6 6 6-6"/></Svg>,
  folder:   (p) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></Svg>,
  plus:     (p) => <Svg {...p}><path d="M12 5v14M5 12h14"/></Svg>,
  filter:   (p) => <Svg {...p}><path d="M4 5h16M7 12h10M10 19h4"/></Svg>,
  gear:     (p) => <Svg {...p}><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M3 12h2.5M18.5 12H21M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></Svg>,
  newFile:  (p) => <Svg {...p}><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/></Svg>,
  mic:      (p) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></Svg>,
  arrowUp:  (p) => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6"/></Svg>,
  check:    (p) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 6.5"/></Svg>,
  checkCircle:(p)=> <Svg {...p}><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></Svg>,
  message:  (p) => <Svg {...p}><path d="M4 5h16v11H9l-4 4z"/></Svg>,
  retry:    (p) => <Svg {...p}><path d="M4 12a8 8 0 1 1 2.3 5.6M4 19v-4h4"/></Svg>,
  warn:     (p) => <Svg {...p}><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/></Svg>,
  alert:    (p) => <Svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/></Svg>,
  diff:     (p) => <Svg {...p}><path d="M12 3v18M5 8h4M7 6v4M15 16h4"/></Svg>,
  file:     (p) => <Svg {...p}><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/></Svg>,
  doc:      (p) => <Svg {...p}><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></Svg>,
  yaml:     (p) => <Svg {...p}><path d="M5 4h14v16H5z"/><path d="M8 9l1.5 2.5L11 9M9.5 11.5V15M14 9v6h2.5"/></Svg>,
  report:   (p) => <Svg {...p}><path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M9 13l1.5 1.5L13 11M9 17h6"/></Svg>,
  external: (p) => <Svg {...p}><path d="M14 5h5v5M19 5l-8 8M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></Svg>,
  copy:     (p) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></Svg>,
  thumbUp:  (p) => <Svg {...p}><path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17 20H7"/></Svg>,
  thumbDown:(p) => <Svg {...p}><path d="M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.3l1-6A2 2 0 0 1 7 4h10"/></Svg>,
  sidebar:  (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></Svg>,
  panel:    (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></Svg>,
  close:    (p) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18"/></Svg>,
  lock:     (p) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></Svg>,
  save:     (p) => <Svg {...p}><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7M8 20v-6h8v6"/></Svg>,
  sliders:  (p) => <Svg {...p}><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></Svg>,
  spark:    (p) => <Svg {...p}><path d="M12 4l1.6 5.4L19 11l-5.4 1.6L12 18l-1.6-5.4L5 11l5.4-1.6z"/></Svg>,
};

window.I = I;
