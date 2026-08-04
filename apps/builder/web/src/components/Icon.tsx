/* ============================================================
   Icon.tsx — minimal stroke UI glyphs (ported from icons.jsx)
   React.createElement → JSX; the `I` glyph map is exported so
   components render <I.folder/>, <I.check/>, etc.
   ============================================================ */
import type { JSX, VNode } from 'preact';

type IconProps = JSX.SVGAttributes<SVGSVGElement>;
type Glyph = (props?: IconProps) => VNode;

function Svg({ children, ...props }: IconProps): VNode {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const I: Record<string, Glyph> = {
  chevron:    (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>,
  folder:     (p) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>,
  plus:       (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  newFile:    (p) => <Svg {...p}><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" /><path d="M13 3v6h6" /></Svg>,
  arrowUp:    (p) => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>,
  download:   (p) => <Svg {...p}><path d="M12 4v10M8 11l4 4 4-4M5 19h14" /></Svg>,
  check:      (p) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 6.5" /></Svg>,
  checkCircle:(p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></Svg>,
  message:    (p) => <Svg {...p}><path d="M4 5h16v11H9l-4 4z" /></Svg>,
  edit:       (p) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>,
  undo:       (p) => <Svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></Svg>,
  retry:      (p) => <Svg {...p}><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Svg>,
  warn:       (p) => <Svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.5" /></Svg>,
  alert:      (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></Svg>,
  diff:       (p) => <Svg {...p}><path d="M12 3v18M5 8h4M7 6v4M15 16h4" /></Svg>,
  doc:        (p) => <Svg {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Svg>,
  yaml:       (p) => <Svg {...p}><path d="M5 4h14v16H5z" /><path d="M8 9l1.5 2.5L11 9M9.5 11.5V15M14 9v6h2.5" /></Svg>,
  report:     (p) => <Svg {...p}><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5M9 13l1.5 1.5L13 11M9 17h6" /></Svg>,
  external:   (p) => <Svg {...p}><path d="M14 5h5v5M19 5l-8 8M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></Svg>,
  link:       (p) => <Svg {...p}><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" /></Svg>,
  copy:       (p) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></Svg>,
  sidebar:    (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Svg>,
  panel:      (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Svg>,
  close:      (p) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  image:      (p) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Svg>,
  paperclip:  (p) => <Svg {...p}><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" /></Svg>,
  lock:       (p) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  save:       (p) => <Svg {...p}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7M8 20v-6h8v6" /></Svg>,
  sliders:    (p) => <Svg {...p}><path d="M4 8h10M18 8h2M4 16h2M10 16h10" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></Svg>,
  spark:      (p) => <Svg {...p}><path d="M12 4l1.6 5.4L19 11l-5.4 1.6L12 18l-1.6-5.4L5 11l5.4-1.6z" /></Svg>,
  chart:      (p) => <Svg {...p}><path d="M4 20h16M7 20v-6M12 20V9M17 20v-4" /></Svg>,
  sun:        (p) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4" /></Svg>,
  moon:       (p) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" /></Svg>,
  globe:      (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z" /></Svg>,
};
