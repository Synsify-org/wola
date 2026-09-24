'use client';
// Magnifying dock (macOS-style). Adapted from the shared Dock component:
//   - motion/react (the package this app already ships) instead of
//     framer-motion — same API, no second copy of the animation runtime;
//   - DockItem renders a real <Link> (href) or <button> (onClick) instead of
//     a div with role="button" + aria-haspopup, so it navigates, is keyboard
//     reachable, and is announced correctly;
//   - pointer tracking uses clientX (the dock is position:fixed, so page
//     scroll must not skew the magnification);
//   - item size is a prop, so phones get a 44px touch target.
// Magnification is a pointer (mouse/trackpad) effect; on touch the dock is
// simply a row of tappable targets with press feedback.

import Link from 'next/link';
import {
  motion,
  type MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
  type SpringOptions,
  AnimatePresence,
} from 'motion/react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

const DOCK_HEIGHT = 128;
const DEFAULT_MAGNIFICATION = 80;
const DEFAULT_DISTANCE = 150;
const DEFAULT_PANEL_HEIGHT = 64;
const DEFAULT_ITEM_SIZE = 40;

type DockProps = {
  children: React.ReactNode;
  className?: string;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  itemSize?: number;
  spring?: SpringOptions;
  'aria-label'?: string;
};
type DockItemProps = {
  className?: string;
  children: React.ReactNode;
  /** Accessible name — the label is visual-only on hover. */
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
};
type DockLabelProps = { className?: string; children: React.ReactNode };
type DockIconProps = { className?: string; children: React.ReactNode };

type DockContextType = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
  itemSize: number;
};

const DockContext = createContext<DockContextType | undefined>(undefined);

function useDock() {
  const context = useContext(DockContext);
  if (!context) throw new Error('useDock must be used within a Dock');
  return context;
}

// Per-item motion values, read by DockLabel/DockIcon through context — not
// cloneElement, whose child-type checks break under Fast Refresh and which
// would otherwise spread these values onto any plain DOM child.
type DockItemContextType = { width: MotionValue<number>; isHovered: MotionValue<number> };
const DockItemContext = createContext<DockItemContextType | undefined>(undefined);

function useDockItem() {
  const context = useContext(DockItemContext);
  if (!context) throw new Error("DockLabel/DockIcon must be used within a DockItem");
  return context;
}

const MotionLink = motion.create(Link);

function Dock({
  children,
  className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
  itemSize = DEFAULT_ITEM_SIZE,
  'aria-label': ariaLabel = 'Application dock',
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(DOCK_HEIGHT, magnification + magnification / 2 + 4),
    [magnification],
  );

  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div
      style={{ height, scrollbarWidth: 'none' }}
      className="mx-2 flex max-w-full items-end overflow-x-auto"
    >
      <motion.nav
        onMouseMove={({ clientX }) => {
          isHovered.set(1);
          mouseX.set(clientX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={cn('mx-auto flex w-fit gap-4 rounded-2xl bg-gray-50 px-4', className)}
        style={{ height: panelHeight }}
        aria-label={ariaLabel}
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification, itemSize }}>
          {children}
        </DockContext.Provider>
      </motion.nav>
    </motion.div>
  );
}

function DockItem({ children, className, label, href, onClick, active = false }: DockItemProps) {
  const ref = useRef<HTMLElement>(null);
  const { distance, magnification, mouseX, spring, itemSize } = useDock();
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - domRect.x - domRect.width / 2;
  });
  const widthTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [itemSize, magnification, itemSize],
  );
  const width = useSpring(widthTransform, spring);

  const shared = {
    style: { width },
    onHoverStart: () => isHovered.set(1),
    onHoverEnd: () => isHovered.set(0),
    // Keyboard focus shows the label; a tap/click focus must not, or the
    // label of the item just clicked stays pinned open after navigating.
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) isHovered.set(1);
    },
    onBlur: () => isHovered.set(0),
    whileTap: { scale: 0.92 },
    'aria-label': label,
    className: cn(
      'relative inline-flex aspect-square shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
      className,
    ),
  };

  const body = <DockItemContext.Provider value={{ width, isHovered }}>{children}</DockItemContext.Provider>;

  return href ? (
    <MotionLink
      ref={ref as React.Ref<HTMLAnchorElement>}
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      {...shared}
    >
      {body}
    </MotionLink>
  ) : (
    <motion.button ref={ref as React.Ref<HTMLButtonElement>} type="button" onClick={onClick} {...shared}>
      {body}
    </motion.button>
  );
}

function DockLabel({ children, className }: DockLabelProps) {
  const { isHovered } = useDockItem();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = isHovered.on('change', (latest) => setIsVisible(latest === 1));
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'pointer-events-none absolute -top-6 left-1/2 w-fit whitespace-pre rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-neutral-700',
            className,
          )}
          aria-hidden
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className }: DockIconProps) {
  const { width } = useDockItem();
  const widthTransform = useTransform(width, (val) => val / 2);

  return (
    <motion.div style={{ width: widthTransform }} className={cn('flex items-center justify-center', className)}>
      {children}
    </motion.div>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
