const { useEffect, useMemo, useRef, useState } = React;

/**
 * Prefiltered Team Compliance Roster (Open + Completed/Exempt Tab)
 * Single-page action workspace (MVP)
 *
 * Plain React + Tailwind only (no external UI libs) to avoid render/import errors.
 */

// -----------------------------
// Constants / Helpers
// -----------------------------

const TAB_OPEN = "open";
const TAB_CLOSED = "closed";

const COVERAGE = {
  HAS_OPEN: "has_open",
  HAS_ASSIGNED_ANY: "has_assigned_any",
  HAS_ASSIGNED_IN_SCOPE: "has_assigned_in_scope",
  NO_ASSIGNED: "no_assigned",
  FULLY_CLOSED: "fully_closed" };


const CONTAINER = { COURSE: "course", PLAN: "plan" };
const LEARNING_TYPE = { ANNUAL: "annual", SELF: "self", LIVE: "live" };

const STATUS_OPEN = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  DUE_SOON: "due_soon",
  OVERDUE: "overdue" };


const STATUS_CLOSED = {
  COMPLETED_ON_TIME: "completed_on_time",
  COMPLETED_LATE: "completed_late",
  EXEMPT: "exempt",
  MARKED_COMPLETE: "marked_complete" };


const REASONS = [
{ value: "policy_exception", label: "Policy exception" },
{ value: "role_change", label: "Role change" },
{ value: "completed_elsewhere", label: "Completed elsewhere" },
{ value: "technical_issue", label: "Technical issue" },
{ value: "other", label: "Other" }];


const REASON_LABEL_BY_VALUE = Object.fromEntries(REASONS.map(r => [r.value, r.label]));
const reasonLabel = v => REASON_LABEL_BY_VALUE[v] || v || "—";

const pad2 = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

// DST-safe day math: compare UTC midnights
function parseISODateUTC(ymd) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function dateDiffDays(a, b) {
  const ua = parseISODateUTC(a);
  const ub = parseISODateUTC(b);
  if (ua == null || ub == null) return 0;
  return Math.floor((ub - ua) / (1000 * 60 * 60 * 24));
}

function isWithin(value, start, end) {
  if (!value) return false;
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

const isOpenStatus = s => Object.values(STATUS_OPEN).includes(s);
const isClosedStatus = s => Object.values(STATUS_CLOSED).includes(s);

/**
 * Effective status (derives Overdue/Due soon from due dates)
 *
 * Rules:
 * - Closed statuses remain as-is.
 * - For open items with a due date:
 *    - dueDate < today => Overdue
 *    - dueDate within next 7 days => Due soon
 */
function effectiveStatus(item, todayIso) {
  if (isClosedStatus(item.status)) return item.status;
  if (!isOpenStatus(item.status)) return item.status;

  const today = todayIso || iso(new Date());
  if (item.dueDate) {
    if (item.dueDate < today) return STATUS_OPEN.OVERDUE;
    const diff = dateDiffDays(today, item.dueDate);
    if (diff >= 0 && diff <= 7) return STATUS_OPEN.DUE_SOON;
  }
  return item.status;
}

function priorityScoreForOpenItem(item, todayIso) {
  const s = effectiveStatus(item, todayIso);
  const base =
  {
    [STATUS_OPEN.OVERDUE]: 400,
    [STATUS_OPEN.DUE_SOON]: 300,
    [STATUS_OPEN.IN_PROGRESS]: 200,
    [STATUS_OPEN.NOT_STARTED]: 100 }[
  s] || 0;

  const today = todayIso || iso(new Date());
  const due = item.dueDate || "9999-12-31";
  const proximityBoost = due < today ? 50 : Math.max(0, 30 - Math.min(30, dateDiffDays(today, due)));
  return base + proximityBoost;
}

function statusLabel(status) {
  const map = {
    [STATUS_OPEN.NOT_STARTED]: "Not started",
    [STATUS_OPEN.IN_PROGRESS]: "In progress",
    [STATUS_OPEN.DUE_SOON]: "Due soon",
    [STATUS_OPEN.OVERDUE]: "Overdue",
    [STATUS_CLOSED.COMPLETED_ON_TIME]: "Completed on time",
    [STATUS_CLOSED.COMPLETED_LATE]: "Completed late",
    [STATUS_CLOSED.EXEMPT]: "Exempt",
    [STATUS_CLOSED.MARKED_COMPLETE]: "Marked complete" };

  return map[status] || status;
}

function pillClass(kind) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium";
  if (kind === "muted") return base + " bg-slate-50 text-slate-700";
  if (kind === "danger") return base + " bg-red-50 text-red-700 border-red-200";
  if (kind === "good") return base + " bg-emerald-50 text-emerald-700 border-emerald-200";
  if (kind === "warn") return base + " bg-amber-50 text-amber-800 border-amber-200";
  if (kind === "outline") return base + " bg-white text-slate-700 border-slate-300";
  return base + " bg-white text-slate-700";
}

function statusPill(status) {
  if (isOpenStatus(status)) {
    if (status === STATUS_OPEN.OVERDUE) return pillClass("danger");
    if (status === STATUS_OPEN.DUE_SOON) return pillClass("warn");
    return pillClass("muted");
  }
  if (status === STATUS_CLOSED.EXEMPT) return pillClass("muted");
  return pillClass("good");
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint32Array(3);
    crypto.getRandomValues(a);
    return Array.from(a).map(n => n.toString(16)).join("");
  }
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function auditUserIds(entry) {
  if (!(entry !== null && entry !== void 0 && entry.userId)) return [];
  return String(entry.userId).
  split(",").
  map(s => s.trim()).
  filter(Boolean);
}

// -----------------------------
// Mock upstream context + data
// -----------------------------

const upstreamContext = {
  title: "Users: My Team",
  chips: [
  { key: "scope", label: "My Team" },
  { key: "tag", label: "Training Plans" },
  { key: "segment", label: "Non-compliant" }] };



const initialUsers = [
{ id: "u1", name: "Avery Chen", role: "RN", department: "Nursing", manager: "Jordan Lee" },
{ id: "u2", name: "Maya Patel", role: "Charge Nurse", department: "Nursing", manager: "Jordan Lee" },
{ id: "u3", name: "Noah Martinez", role: "CNA", department: "Nursing", manager: "Jordan Lee" },
{ id: "u4", name: "Sam Nguyen", role: "Unit Clerk", department: "Nursing", manager: "Jordan Lee" },
{ id: "u5", name: "Olivia Brooks", role: "RN", department: "ICU", manager: "Terry Kim" },
{ id: "u6", name: "Ethan Wright", role: "Tech", department: "Radiology", manager: "Casey Reed" }];


const initialAssignments = [
{
  id: "a1",
  userId: "u1",
  container: CONTAINER.COURSE,
  name: "Annual Safety Training",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-30),
  dueDate: daysFromNow(-2),
  completionDate: null,
  status: STATUS_OPEN.NOT_STARTED },

{
  id: "a2",
  userId: "u1",
  container: CONTAINER.PLAN,
  name: "HIPAA Refresher Plan",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-10),
  dueDate: daysFromNow(5),
  completionDate: null,
  status: STATUS_OPEN.IN_PROGRESS },

{
  id: "a3",
  userId: "u2",
  container: CONTAINER.COURSE,
  name: "Workplace Violence Prevention",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-50),
  dueDate: daysFromNow(-20),
  completionDate: daysFromNow(-10),
  status: STATUS_CLOSED.COMPLETED_LATE },

{
  id: "a4",
  userId: "u2",
  container: CONTAINER.COURSE,
  name: "Annual Fire Safety",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-7),
  dueDate: daysFromNow(20),
  completionDate: null,
  status: STATUS_OPEN.IN_PROGRESS },

{
  id: "a5",
  userId: "u3",
  container: CONTAINER.PLAN,
  name: "Infection Control Plan",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-60),
  dueDate: daysFromNow(-30),
  completionDate: daysFromNow(-40),
  status: STATUS_CLOSED.COMPLETED_ON_TIME },

{
  id: "a6",
  userId: "u3",
  container: CONTAINER.COURSE,
  name: "CPR Live Skills Check",
  type: LEARNING_TYPE.LIVE,
  assignedDate: daysFromNow(-14),
  dueDate: daysFromNow(6),
  completionDate: null,
  status: STATUS_OPEN.NOT_STARTED },

{
  id: "a7",
  userId: "u3",
  container: CONTAINER.COURSE,
  name: "Bloodborne Pathogens",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-14),
  dueDate: daysFromNow(14),
  completionDate: null,
  status: STATUS_CLOSED.EXEMPT },

{
  id: "a8",
  userId: "u5",
  container: CONTAINER.COURSE,
  name: "ICU Equipment Orientation",
  type: LEARNING_TYPE.SELF,
  assignedDate: daysFromNow(-90),
  dueDate: daysFromNow(-60),
  completionDate: daysFromNow(-62),
  status: STATUS_CLOSED.COMPLETED_ON_TIME },

{
  id: "a9",
  userId: "u5",
  container: CONTAINER.PLAN,
  name: "Training Plans Plan",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-90),
  dueDate: daysFromNow(-30),
  completionDate: daysFromNow(-15),
  status: STATUS_CLOSED.MARKED_COMPLETE },

{
  id: "a10",
  userId: "u6",
  container: CONTAINER.COURSE,
  name: "Radiation Safety Basics",
  type: LEARNING_TYPE.ANNUAL,
  assignedDate: daysFromNow(-20),
  dueDate: daysFromNow(3),
  completionDate: null,
  status: STATUS_OPEN.NOT_STARTED },

{
  id: "a11",
  userId: "u6",
  container: CONTAINER.COURSE,
  name: "Optional: Excel for Humans",
  type: LEARNING_TYPE.SELF,
  assignedDate: daysFromNow(-15),
  dueDate: null,
  completionDate: daysFromNow(-2),
  status: STATUS_CLOSED.COMPLETED_ON_TIME }];



// -----------------------------
// Tests (console assertions)
// -----------------------------

function runSelfTests() {
  const today = iso(new Date());
  const overdue = { status: STATUS_OPEN.NOT_STARTED, dueDate: daysFromNow(-1) };
  const dueSoon = { status: STATUS_OPEN.NOT_STARTED, dueDate: daysFromNow(3) };
  const future = { status: STATUS_OPEN.NOT_STARTED, dueDate: daysFromNow(30) };
  const closed = { status: STATUS_CLOSED.EXEMPT, dueDate: daysFromNow(-1) };

  console.assert(effectiveStatus(overdue, today) === STATUS_OPEN.OVERDUE, "Expected overdue");
  console.assert(effectiveStatus(dueSoon, today) === STATUS_OPEN.DUE_SOON, "Expected due soon");
  console.assert(effectiveStatus(future, today) === STATUS_OPEN.NOT_STARTED, "Expected to remain not started");
  console.assert(effectiveStatus(closed, today) === STATUS_CLOSED.EXEMPT, "Expected closed to remain closed");
  console.assert(today.length === 10, "Expected ISO date format");

  const boundary = { status: STATUS_OPEN.NOT_STARTED, dueDate: daysFromNow(7) };
  console.assert(effectiveStatus(boundary, today) === STATUS_OPEN.DUE_SOON, "Expected due soon at 7 days");
}

// -----------------------------
// UI primitives (dependency-free)
// -----------------------------

function Chip({ label }) {
  return /*#__PURE__*/React.createElement("span", { className: pillClass("muted") + " px-3 py-1" }, label);
}

function IconButton({ title, onClick, children }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      title: title,
      onClick: onClick,
      type: "button",
      className: "inline-flex h-9 w-9 items-center justify-center rounded-xl border hover:bg-slate-50" },

    children));


}

function PrimaryButton({ onClick, children, disabled }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      disabled: disabled,
      onClick: onClick,
      type: "button",
      className:
      "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium " + (
      disabled ? "bg-slate-200 text-slate-500" : "bg-slate-900 text-white hover:bg-slate-800") },


    children));


}

function SecondaryButton({ onClick, children }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      onClick: onClick,
      type: "button",
      className: "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-slate-50" },

    children));


}

function GhostButton({ onClick, children }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      onClick: onClick,
      type: "button",
      className: "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium hover:bg-slate-50" },

    children));


}

function Card({ children }) {
  return /*#__PURE__*/React.createElement("div", { className: "rounded-2xl border bg-white shadow-sm" }, children);
}

function CardHeader({ title, right, subtitle }) {
  return /*#__PURE__*/(
    React.createElement("div", { className: "px-5 pt-5 pb-3" }, /*#__PURE__*/
    React.createElement("div", { className: "flex items-start justify-between gap-3" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-base font-semibold" }, title),
    subtitle ? /*#__PURE__*/React.createElement("div", { className: "mt-1 text-xs text-slate-500" }, subtitle) : null),

    right)));



}

function CardContent({ children }) {
  return /*#__PURE__*/React.createElement("div", { className: "px-5 pb-5" }, children);
}

function Modal({ open, title, onClose, children, footer }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = e => {
      if (e.key === "Escape") onClose === null || onClose === void 0 ? void 0 : onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const t = setTimeout(() => {var _panelRef$current, _el$focus;
      const el =
      ((_panelRef$current = panelRef.current) === null || _panelRef$current === void 0 ? void 0 : _panelRef$current.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) ||
      null;
      el === null || el === void 0 ? void 0 : (_el$focus = el.focus) === null || _el$focus === void 0 ? void 0 : _el$focus.call(el);
    }, 0);

    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const titleId = "modal-title-" + uid();

  return /*#__PURE__*/(
    React.createElement("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
      onMouseDown: e => {
        if (e.target === e.currentTarget) onClose === null || onClose === void 0 ? void 0 : onClose();
      },
      role: "presentation" }, /*#__PURE__*/

    React.createElement("div", {
      ref: panelRef,
      className: "w-full max-w-lg rounded-2xl bg-white shadow-xl",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId }, /*#__PURE__*/

    React.createElement("div", { className: "flex items-center justify-between border-b px-5 py-4" }, /*#__PURE__*/
    React.createElement("div", { id: titleId, className: "text-sm font-semibold" },
    title), /*#__PURE__*/

    React.createElement(IconButton, { title: "Close", onClick: onClose }, "\u2715")), /*#__PURE__*/



    React.createElement("div", { className: "px-5 py-4" }, children),
    footer ? /*#__PURE__*/React.createElement("div", { className: "border-t px-5 py-4" }, footer) : null)));



}

function Popover({ open, onClose, align = "right", width = "360px", children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = e => {
      if (e.key === "Escape") onClose === null || onClose === void 0 ? void 0 : onClose();
    };

    const onPointerDown = e => {
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      onClose === null || onClose === void 0 ? void 0 : onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const alignClass = align === "left" ? "left-0" : "right-0";

  return /*#__PURE__*/(
    React.createElement("div", {
      ref: ref,
      className: "absolute z-40 mt-2 rounded-2xl border bg-white shadow-xl " + alignClass,
      style: { width } },

    children));


}

function Toggle({ checked, onChange }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      type: "button",
      onClick: () => onChange(!checked),
      className: "h-6 w-10 rounded-full border p-0.5 transition " + (checked ? "bg-slate-900" : "bg-slate-200"),
      "aria-pressed": checked }, /*#__PURE__*/

    React.createElement("div", { className: "h-5 w-5 rounded-full bg-white transition " + (checked ? "translate-x-4" : "translate-x-0") })));


}

// -----------------------------
// App
// -----------------------------

function App() {
  const [tab, setTab] = useState(TAB_OPEN);

  const users = initialUsers;
  const [assignments, setAssignments] = useState(initialAssignments);

  const [selectedUserIds, setSelectedUserIds] = useState(() => new Set());

  const [activeUserId, setActiveUserId] = useState(null);
  const [detailSubtab, setDetailSubtab] = useState(CONTAINER.COURSE);

  const [todayIso, setTodayIso] = useState(() => iso(new Date()));
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const ms = nextMidnight.getTime() - now.getTime();
    const t = setTimeout(() => setTodayIso(iso(new Date())), ms + 50);
    return () => clearTimeout(t);
  }, [todayIso]);

  // Filters
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [includeCoverageGapsInOpenDefault, setIncludeCoverageGapsInOpenDefault] = useState(true);

  const [coverageFilter, setCoverageFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState({
    [LEARNING_TYPE.ANNUAL]: true,
    [LEARNING_TYPE.SELF]: true,
    [LEARNING_TYPE.LIVE]: true });

  const [containerFilter, setContainerFilter] = useState({
    [CONTAINER.COURSE]: true,
    [CONTAINER.PLAN]: true });

  const [statusFilterOpen, setStatusFilterOpen] = useState({
    [STATUS_OPEN.NOT_STARTED]: true,
    [STATUS_OPEN.IN_PROGRESS]: true,
    [STATUS_OPEN.DUE_SOON]: true,
    [STATUS_OPEN.OVERDUE]: true });

  const [statusFilterClosed, setStatusFilterClosed] = useState({
    [STATUS_CLOSED.COMPLETED_ON_TIME]: true,
    [STATUS_CLOSED.COMPLETED_LATE]: true,
    [STATUS_CLOSED.EXEMPT]: true,
    [STATUS_CLOSED.MARKED_COMPLETE]: true });

  const [dateFilter, setDateFilter] = useState({
    assignedStart: "",
    assignedEnd: "",
    dueStart: "",
    dueEnd: "",
    completedStart: "",
    completedEnd: "" });


  // dialogs
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTargetUserIds, setAssignTargetUserIds] = useState([]);

  const [guardOpen, setGuardOpen] = useState(false);
  const [guardKind, setGuardKind] = useState("mark_complete");
  const [guardItemId, setGuardItemId] = useState(null);
  const [guardReason, setGuardReason] = useState("");
  const [guardNote, setGuardNote] = useState("");

  // audit
  const [audit, setAudit] = useState([]);
  const actor = "Admin (You)";

  useEffect(() => {
    runSelfTests();
  }, []);

  // assignment map
  const userAssignments = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(u.id, []);
    for (const a of assignments) {
      if (!map.has(a.userId)) map.set(a.userId, []);
      map.get(a.userId).push(a);
    }
    return map;
  }, [users, assignments]);

  const computedRoster = useMemo(() => {
    return users.map(u => {
      const items = userAssignments.get(u.id) || [];

      const openItems = items.filter(it => isOpenStatus(it.status));
      const closedItems = items.filter(it => isClosedStatus(it.status));

      const completed = items.filter((it) =>
      [STATUS_CLOSED.COMPLETED_ON_TIME, STATUS_CLOSED.COMPLETED_LATE, STATUS_CLOSED.MARKED_COMPLETE].includes(it.status));


      const onTimeCount = completed.filter(it => {
        if (!it.completionDate) return false;
        if (!it.dueDate) return true;
        return it.completionDate <= it.dueDate;
      }).length;

      const urgency = openItems.reduce((acc, it) => acc + priorityScoreForOpenItem(it, todayIso), 0);

      const mostRecent =
      items.
      map(it => it.completionDate || it.assignedDate).
      filter(Boolean).
      sort((a, b) => b.localeCompare(a))[0] || "";

      return {
        user: u,
        assignedCount: items.length,
        openCount: openItems.length,
        openItems,
        closedItems,
        onTimeCount,
        coverageGap: items.length === 0,
        urgency,
        mostRecent };

    });
  }, [users, userAssignments, todayIso]);

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();

    const enabledTypes = new Set(Object.keys(typeFilter).filter(k => typeFilter[k]));
    const enabledContainers = new Set(Object.keys(containerFilter).filter(k => containerFilter[k]));
    const enabledOpenStatuses = new Set(Object.keys(statusFilterOpen).filter(k => statusFilterOpen[k]));
    const enabledClosedStatuses = new Set(Object.keys(statusFilterClosed).filter(k => statusFilterClosed[k]));

    const rows = computedRoster.
    map(row => {
      const itemPass = it => {
        if (!enabledTypes.has(it.type)) return false;
        if (!enabledContainers.has(it.container)) return false;

        if (tab === TAB_OPEN) {
          if (!isOpenStatus(it.status)) return false;
          const s = effectiveStatus(it, todayIso);
          if (!enabledOpenStatuses.has(s)) return false;

          if (dateFilter.assignedStart || dateFilter.assignedEnd) {
            if (!isWithin(it.assignedDate, dateFilter.assignedStart, dateFilter.assignedEnd)) return false;
          }
          if (dateFilter.dueStart || dateFilter.dueEnd) {
            if (!it.dueDate) return false;
            if (!isWithin(it.dueDate, dateFilter.dueStart, dateFilter.dueEnd)) return false;
          }
          return true;
        }

        if (!isClosedStatus(it.status)) return false;
        if (!enabledClosedStatuses.has(it.status)) return false;

        if (dateFilter.assignedStart || dateFilter.assignedEnd) {
          if (!isWithin(it.assignedDate, dateFilter.assignedStart, dateFilter.assignedEnd)) return false;
        }
        if (dateFilter.completedStart || dateFilter.completedEnd) {
          if (!it.completionDate) return false;
          if (!isWithin(it.completionDate, dateFilter.completedStart, dateFilter.completedEnd)) return false;
        }
        return true;
      };

      const openItemsFiltered = row.openItems.filter(itemPass);
      const closedItemsFiltered = row.closedItems.filter(itemPass);

      const overdueCount = openItemsFiltered.filter(it => effectiveStatus(it, todayIso) === STATUS_OPEN.OVERDUE).length;
      const dueSoonCount = openItemsFiltered.filter(it => effectiveStatus(it, todayIso) === STATUS_OPEN.DUE_SOON).length;

      const hasOpenInScope = openItemsFiltered.length > 0;
      const hasAssignedInScope = (tab === TAB_OPEN ? openItemsFiltered.length : closedItemsFiltered.length) > 0;

      const coveragePass = (() => {
        if (!coverageFilter) {
          if (tab === TAB_OPEN) {
            return hasOpenInScope || includeCoverageGapsInOpenDefault && row.coverageGap;
          }
          return hasAssignedInScope;
        }
        switch (coverageFilter) {
          case COVERAGE.HAS_OPEN:
            return hasOpenInScope;
          case COVERAGE.HAS_ASSIGNED_ANY:
            return row.assignedCount > 0;
          case COVERAGE.HAS_ASSIGNED_IN_SCOPE:
            return hasAssignedInScope;
          case COVERAGE.NO_ASSIGNED:
            return row.coverageGap;
          case COVERAGE.FULLY_CLOSED:
            return row.assignedCount > 0 && row.openCount === 0;
          default:
            return true;}

      })();

      const searchPass = !q ?
      true :
      [row.user.name, row.user.role, row.user.department, row.user.manager].join(" ").toLowerCase().includes(q);

      return {
        ...row,
        openItemsFiltered,
        closedItemsFiltered,
        overdueCount,
        dueSoonCount,
        coveragePass,
        searchPass };

    }).
    filter(r => r.coveragePass && r.searchPass);

    if (tab === TAB_OPEN) {
      rows.sort((a, b) => {
        if (b.openItemsFiltered.length !== a.openItemsFiltered.length) return b.openItemsFiltered.length - a.openItemsFiltered.length;
        if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
        if (b.dueSoonCount !== a.dueSoonCount) return b.dueSoonCount - a.dueSoonCount;
        if (b.urgency !== a.urgency) return b.urgency - a.urgency;
        return a.user.name.localeCompare(b.user.name);
      });
    } else {
      rows.sort((a, b) => {
        const ar = a.mostRecent || "0000-00-00";
        const br = b.mostRecent || "0000-00-00";
        if (br !== ar) return br.localeCompare(ar);
        return a.user.name.localeCompare(b.user.name);
      });
    }

    return rows;
  }, [
  computedRoster,
  tab,
  search,
  typeFilter,
  containerFilter,
  statusFilterOpen,
  statusFilterClosed,
  dateFilter,
  coverageFilter,
  includeCoverageGapsInOpenDefault,
  todayIso]);


  const headerStats = useMemo(() => {
    const totalUsers = filteredRoster.length;
    const coverageGaps = filteredRoster.filter(r => r.coverageGap).length;
    const totalOpen = filteredRoster.reduce((acc, r) => acc + r.openItemsFiltered.length, 0);
    const totalOverdue = filteredRoster.reduce((acc, r) => acc + r.overdueCount, 0);
    const totalDueSoon = filteredRoster.reduce((acc, r) => acc + r.dueSoonCount, 0);
    return { totalUsers, coverageGaps, totalOpen, totalOverdue, totalDueSoon };
  }, [filteredRoster]);

  const selectedCount = selectedUserIds.size;

  const activeUser = useMemo(() => users.find(u => u.id === activeUserId) || null, [users, activeUserId]);

  const activeUserItems = useMemo(() => activeUser ? userAssignments.get(activeUser.id) || [] : [], [activeUser, userAssignments]);

  const activeUserCourses = useMemo(
  () => activeUserItems.filter(it => it.container === CONTAINER.COURSE),
  [activeUserItems]);

  const activeUserPlans = useMemo(
  () => activeUserItems.filter(it => it.container === CONTAINER.PLAN),
  [activeUserItems]);


  const toggleSelectUser = (userId, checked) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(userId);else
      next.delete(userId);
      return next;
    });
  };

  const toggleSelectAll = checked => {
    if (!checked) return setSelectedUserIds(new Set());
    setSelectedUserIds(new Set(filteredRoster.map(r => r.user.id)));
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  const logAudit = entry => {
    setAudit(prev => [{ id: uid(), ts: new Date().toISOString(), actor, ...entry }, ...prev]);
  };

  const bulkAction = kind => {
    const ids = Array.from(selectedUserIds);
    logAudit({
      action: kind,
      entityType: "bulk_users",
      entityId: ids.join(","),
      userId: ids.join(","),
      reason: null,
      note: `${kind} sent to ${ids.length} user(s).` });

    clearSelection();
  };

  const openAssign = userIds => {
    setAssignTargetUserIds(userIds);
    setAssignOpen(true);
  };

  const assignLearningToUsers = ({ container, type, name, dueDate }) => {
    const newItems = assignTargetUserIds.map(uid2 => ({
      id: uid(),
      userId: uid2,
      container,
      name,
      type,
      assignedDate: todayIso,
      dueDate: dueDate || null,
      completionDate: null,
      status: STATUS_OPEN.NOT_STARTED }));


    setAssignments(prev => [...prev, ...newItems]);
    logAudit({
      action: "assign_learning",
      entityType: "learning",
      entityId: name,
      userId: assignTargetUserIds.join(","),
      reason: "n/a",
      note: `Assigned ${container} “${name}” to ${assignTargetUserIds.length} user(s).` });

    setAssignOpen(false);
  };

  const openGuard = (kind, itemId) => {
    setGuardKind(kind);
    setGuardItemId(itemId);
    setGuardReason("");
    setGuardNote("");
    setGuardOpen(true);
  };

  const confirmGuard = () => {
    if (!guardItemId || !guardReason) return;

    const nextStatus = guardKind === "exempt" ? STATUS_CLOSED.EXEMPT : STATUS_CLOSED.MARKED_COMPLETE;

    setAssignments((prev) =>
    prev.map(it => {
      if (it.id !== guardItemId) return it;
      const updated = { ...it, status: nextStatus };
      if (nextStatus === STATUS_CLOSED.MARKED_COMPLETE) updated.completionDate = todayIso;
      if (nextStatus === STATUS_CLOSED.EXEMPT) updated.completionDate = null;
      return updated;
    }));


    const item = assignments.find(x => x.id === guardItemId);
    logAudit({
      action: guardKind === "exempt" ? "exempt" : "mark_complete",
      entityType: "assignment",
      entityId: guardItemId,
      userId: (item === null || item === void 0 ? void 0 : item.userId) || null,
      reason: guardReason, // canonical value
      note: guardNote || "" });


    setGuardOpen(false);
  };

  const allVisibleSelected = useMemo(() => {
    if (filteredRoster.length === 0) return false;
    return filteredRoster.every(r => selectedUserIds.has(r.user.id));
  }, [filteredRoster, selectedUserIds]);

  return /*#__PURE__*/(
    React.createElement("div", { className: "min-h-screen bg-slate-50" }, /*#__PURE__*/
    React.createElement("div", { className: "mx-auto max-w-7xl px-4 py-6" }, /*#__PURE__*/

    React.createElement("div", { className: "sticky top-0 z-30 -mx-4 mb-4 border-b bg-white/80 px-4 py-4 backdrop-blur" }, /*#__PURE__*/
    React.createElement("div", { className: "flex flex-col gap-3" }, /*#__PURE__*/
    React.createElement("div", { className: "flex items-start justify-between gap-3" }, /*#__PURE__*/
    React.createElement("div", { className: "min-w-0" }, /*#__PURE__*/
    React.createElement("div", { className: "flex items-center gap-2" }, /*#__PURE__*/
    React.createElement("h1", { className: "text-xl font-semibold tracking-tight text-slate-900" }, upstreamContext.title), /*#__PURE__*/
    React.createElement("div", { className: "relative" }, /*#__PURE__*/
    React.createElement(IconButton, { title: "Compliance definition", onClick: () => setInfoOpen(v => !v) }, "i"), /*#__PURE__*/


    React.createElement(Popover, { open: infoOpen, onClose: () => setInfoOpen(false), align: "left", width: "320px" }, /*#__PURE__*/
    React.createElement("div", { className: "p-3 text-sm" }, /*#__PURE__*/
    React.createElement("div", { className: "font-semibold" }, "Compliance definition"), /*#__PURE__*/
    React.createElement("div", { className: "mt-1 text-slate-600" }, "Compliance = assigned courses completed on or before due date."))))), /*#__PURE__*/






    React.createElement("div", { className: "mt-2 flex flex-wrap gap-2" },
    upstreamContext.chips.map((c) => /*#__PURE__*/
    React.createElement(Chip, { key: c.key, label: c.label })))), /*#__PURE__*/




    React.createElement("div", { className: "hidden md:flex flex-wrap items-center justify-end gap-2" }, /*#__PURE__*/
    React.createElement("span", { className: pillClass(headerStats.totalOverdue > 0 ? "danger" : "muted") }, "Overdue: ",
    headerStats.totalOverdue), /*#__PURE__*/

    React.createElement("span", { className: pillClass(headerStats.coverageGaps > 0 ? "danger" : "muted") }, "Coverage gaps: ",
    headerStats.coverageGaps), /*#__PURE__*/

    React.createElement("span", { className: pillClass(headerStats.totalDueSoon > 0 ? "warn" : "muted") }, "Due soon: ",
    headerStats.totalDueSoon), /*#__PURE__*/

    React.createElement("span", { className: pillClass("muted") }, "Open: ", headerStats.totalOpen), /*#__PURE__*/
    React.createElement("span", { className: pillClass("outline") }, "Users: ", headerStats.totalUsers))), /*#__PURE__*/




    React.createElement("div", { className: "flex flex-col gap-2 md:flex-row md:items-center md:justify-between" }, /*#__PURE__*/
    React.createElement("div", { className: "flex flex-1 items-center gap-2" }, /*#__PURE__*/
    React.createElement("div", { className: "relative w-full max-w-xl" }, /*#__PURE__*/
    React.createElement("input", {
      value: search,
      onChange: e => setSearch(e.target.value),
      placeholder: "Search name, role, course, training plan, department, manager",
      className: "w-full rounded-2xl border bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" })), /*#__PURE__*/



    React.createElement("div", { className: "relative" }, /*#__PURE__*/
    React.createElement(SecondaryButton, { onClick: () => setFiltersOpen(v => !v) }, "Filters"), /*#__PURE__*/
    React.createElement(Popover, { open: filtersOpen, onClose: () => setFiltersOpen(false) }, /*#__PURE__*/
    React.createElement(FiltersPanel, {
      tab: tab,
      coverageFilter: coverageFilter,
      setCoverageFilter: setCoverageFilter,
      includeCoverageGapsInOpenDefault: includeCoverageGapsInOpenDefault,
      setIncludeCoverageGapsInOpenDefault: setIncludeCoverageGapsInOpenDefault,
      typeFilter: typeFilter,
      setTypeFilter: setTypeFilter,
      containerFilter: containerFilter,
      setContainerFilter: setContainerFilter,
      statusFilterOpen: statusFilterOpen,
      setStatusFilterOpen: setStatusFilterOpen,
      statusFilterClosed: statusFilterClosed,
      setStatusFilterClosed: setStatusFilterClosed,
      dateFilter: dateFilter,
      setDateFilter: setDateFilter,
      onClose: () => setFiltersOpen(false) })))), /*#__PURE__*/





    React.createElement("span", { className: pillClass("muted") }, "Action workspace")))), /*#__PURE__*/





    React.createElement("div", { className: "flex flex-col gap-3" }, /*#__PURE__*/
    React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3" }, /*#__PURE__*/
    React.createElement("div", { className: "inline-flex rounded-2xl border bg-white p-1" }, /*#__PURE__*/
    React.createElement("button", {
      type: "button",
      onClick: () => {
        setTab(TAB_OPEN);
        clearSelection();
        setActiveUserId(null);
      },
      className:
      "rounded-2xl px-4 py-2 text-sm font-medium " + (
      tab === TAB_OPEN ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50") }, "Open Assignments"), /*#__PURE__*/




    React.createElement("button", {
      type: "button",
      onClick: () => {
        setTab(TAB_CLOSED);
        clearSelection();
        setActiveUserId(null);
      },
      className:
      "rounded-2xl px-4 py-2 text-sm font-medium " + (
      tab === TAB_CLOSED ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50") }, "Completed & Exempt")),






    selectedCount > 0 ? /*#__PURE__*/
    React.createElement("div", { className: "flex flex-wrap items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm" }, /*#__PURE__*/
    React.createElement("span", { className: pillClass("muted") }, selectedCount, " selected"), /*#__PURE__*/
    React.createElement(PrimaryButton, { onClick: () => bulkAction("send_reminder") }, "\uD83D\uDD14 Send reminder"), /*#__PURE__*/
    React.createElement(SecondaryButton, { onClick: () => bulkAction("escalate") }, "\uD83D\uDEE1\uFE0F Escalate"), /*#__PURE__*/
    React.createElement(SecondaryButton, { onClick: () => openAssign(Array.from(selectedUserIds)) }, "\u2795 Assign learning"), /*#__PURE__*/
    React.createElement(GhostButton, { onClick: clearSelection }, "Clear")) :

    null), /*#__PURE__*/



    React.createElement("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-12" }, /*#__PURE__*/
    React.createElement("div", { className: activeUser ? "lg:col-span-7" : "lg:col-span-12" }, /*#__PURE__*/
    React.createElement(RosterTable, {
      tab: tab,
      rows: filteredRoster,
      selectedUserIds: selectedUserIds,
      allVisibleSelected: allVisibleSelected,
      onToggleSelectAll: toggleSelectAll,
      onToggleSelectUser: toggleSelectUser,
      onOpenDetails: userId => {
        setActiveUserId(userId);
        setDetailSubtab(CONTAINER.COURSE);
      },
      onQuickAction: (kind, userId) => {
        logAudit({
          action: kind,
          entityType: "user",
          entityId: userId,
          userId,
          reason: null,
          note: "" });

      },
      onAssign: userId => openAssign([userId]) })),



    activeUser ? /*#__PURE__*/
    React.createElement("div", { className: "lg:col-span-5" }, /*#__PURE__*/
    React.createElement(DetailsPanel, {
      tab: tab,
      user: activeUser,
      items: activeUserItems,
      courses: activeUserCourses,
      plans: activeUserPlans,
      detailSubtab: detailSubtab,
      setDetailSubtab: setDetailSubtab,
      onClose: () => setActiveUserId(null),
      onAssign: () => openAssign([activeUser.id]),
      onMarkComplete: itemId => openGuard("mark_complete", itemId),
      onExempt: itemId => openGuard("exempt", itemId),
      audit: audit.filter(a => auditUserIds(a).includes(activeUser.id)).slice(0, 25) })) :


    null), /*#__PURE__*/



    React.createElement(Card, null, /*#__PURE__*/
    React.createElement(CardHeader, { title: "Recent audit log", subtitle: "A thin slice for MVP (latest 10)" }), /*#__PURE__*/
    React.createElement(CardContent, null,
    audit.length === 0 ? /*#__PURE__*/
    React.createElement("div", { className: "text-sm text-slate-600" }, "No actions yet. Select a user and mark an item complete/exempt.") : /*#__PURE__*/



    React.createElement("div", { className: "space-y-2" },
    audit.slice(0, 10).map((a) => /*#__PURE__*/
    React.createElement("div", { key: a.id, className: "rounded-2xl border bg-white p-3" }, /*#__PURE__*/
    React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-2" }, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold text-slate-900" },
    String(a.action || "").replaceAll("_", " "), " \u2022 ", a.actor), /*#__PURE__*/

    React.createElement("div", { className: "text-xs text-slate-500" }, new Date(a.ts).toLocaleString())), /*#__PURE__*/

    React.createElement("div", { className: "mt-1 text-xs text-slate-600" }, /*#__PURE__*/
    React.createElement("span", { className: "font-semibold" }, "Entity:"), " ", a.entityType, " (", a.entityId, ")",
    a.reason ? /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("span", { className: "mx-2" }, "\u2022"), /*#__PURE__*/
    React.createElement("span", { className: "font-semibold" }, "Reason:"), " ", reasonLabel(a.reason)) :

    null),

    a.note ? /*#__PURE__*/React.createElement("div", { className: "mt-1 text-xs text-slate-600" }, a.note) : null))))), /*#__PURE__*/







    React.createElement("div", { className: "pt-4 text-center text-xs text-slate-500" }, "MVP demo. Swap mock data with API calls and pass upstream filters via route state/query params."))), /*#__PURE__*/






    React.createElement(AssignModal, {
      open: assignOpen,
      onClose: () => setAssignOpen(false),
      onAssign: assignLearningToUsers,
      targetCount: assignTargetUserIds.length }), /*#__PURE__*/



    React.createElement(Modal, {
      open: guardOpen,
      title: guardKind === "exempt" ? "Exempt item" : "Mark item complete",
      onClose: () => setGuardOpen(false),
      footer: /*#__PURE__*/
      React.createElement("div", { className: "flex items-center justify-end gap-2" }, /*#__PURE__*/
      React.createElement(GhostButton, { onClick: () => setGuardOpen(false) }, "Cancel"), /*#__PURE__*/
      React.createElement(PrimaryButton, { onClick: confirmGuard, disabled: !guardReason }, "Confirm")) }, /*#__PURE__*/





    React.createElement("div", { className: "space-y-3" }, /*#__PURE__*/
    React.createElement("div", { className: "rounded-2xl border bg-slate-50 p-3 text-sm text-slate-700" }, "Guardrail: This action requires a reason and will be written to the audit log."), /*#__PURE__*/



    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Reason (required)"), /*#__PURE__*/
    React.createElement("select", {
      value: guardReason,
      onChange: e => setGuardReason(e.target.value),
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" }, /*#__PURE__*/

    React.createElement("option", { value: "" }, "Select a reason"),
    REASONS.map((r) => /*#__PURE__*/
    React.createElement("option", { key: r.value, value: r.value },
    r.label)))), /*#__PURE__*/





    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Note (optional)"), /*#__PURE__*/
    React.createElement("textarea", {
      value: guardNote,
      onChange: e => setGuardNote(e.target.value),
      rows: 3,
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm",
      placeholder: "Add details for audit..." }))))));






}

// -----------------------------
// Filters Panel
// -----------------------------

function FiltersPanel({
  tab,
  coverageFilter,
  setCoverageFilter,
  includeCoverageGapsInOpenDefault,
  setIncludeCoverageGapsInOpenDefault,
  typeFilter,
  setTypeFilter,
  containerFilter,
  setContainerFilter,
  statusFilterOpen,
  setStatusFilterOpen,
  statusFilterClosed,
  setStatusFilterClosed,
  dateFilter,
  setDateFilter,
  onClose })
{
  const reset = () => {
    setCoverageFilter(null);
    setTypeFilter({
      [LEARNING_TYPE.ANNUAL]: true,
      [LEARNING_TYPE.SELF]: true,
      [LEARNING_TYPE.LIVE]: true });

    setContainerFilter({ [CONTAINER.COURSE]: true, [CONTAINER.PLAN]: true });
    setStatusFilterOpen({
      [STATUS_OPEN.NOT_STARTED]: true,
      [STATUS_OPEN.IN_PROGRESS]: true,
      [STATUS_OPEN.DUE_SOON]: true,
      [STATUS_OPEN.OVERDUE]: true });

    setStatusFilterClosed({
      [STATUS_CLOSED.COMPLETED_ON_TIME]: true,
      [STATUS_CLOSED.COMPLETED_LATE]: true,
      [STATUS_CLOSED.EXEMPT]: true,
      [STATUS_CLOSED.MARKED_COMPLETE]: true });

    setDateFilter({
      assignedStart: "",
      assignedEnd: "",
      dueStart: "",
      dueEnd: "",
      completedStart: "",
      completedEnd: "" });

  };

  return /*#__PURE__*/(
    React.createElement("div", { className: "p-4" }, /*#__PURE__*/
    React.createElement("div", { className: "flex items-start justify-between gap-3" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Filters"), /*#__PURE__*/
    React.createElement("div", { className: "mt-1 text-xs text-slate-500" }, "Scope is inherited from upstream. Refine here.")), /*#__PURE__*/

    React.createElement("div", { className: "flex items-center gap-2" }, /*#__PURE__*/
    React.createElement(GhostButton, { onClick: reset }, "Reset"), /*#__PURE__*/
    React.createElement(IconButton, { title: "Close", onClick: onClose }, "\u2715"))), /*#__PURE__*/





    React.createElement("div", { className: "mt-4 space-y-4" }, /*#__PURE__*/

    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Assignment coverage"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 grid grid-cols-2 gap-2" }, /*#__PURE__*/
    React.createElement(FilterButton, {
      active: coverageFilter === COVERAGE.HAS_OPEN,
      onClick: () => setCoverageFilter(coverageFilter === COVERAGE.HAS_OPEN ? null : COVERAGE.HAS_OPEN) }, "Has open"), /*#__PURE__*/




    React.createElement(FilterButton, {
      active: coverageFilter === COVERAGE.HAS_ASSIGNED_IN_SCOPE,
      onClick: () =>
      setCoverageFilter(
      coverageFilter === COVERAGE.HAS_ASSIGNED_IN_SCOPE ? null : COVERAGE.HAS_ASSIGNED_IN_SCOPE) }, "Has assigned (in scope)"), /*#__PURE__*/






    React.createElement(FilterButton, {
      active: coverageFilter === COVERAGE.HAS_ASSIGNED_ANY,
      onClick: () => setCoverageFilter(coverageFilter === COVERAGE.HAS_ASSIGNED_ANY ? null : COVERAGE.HAS_ASSIGNED_ANY) }, "Has assigned (any)"), /*#__PURE__*/




    React.createElement(FilterButton, {
      active: coverageFilter === COVERAGE.NO_ASSIGNED,
      onClick: () => setCoverageFilter(coverageFilter === COVERAGE.NO_ASSIGNED ? null : COVERAGE.NO_ASSIGNED) }, "Not assigned \u2B50"), /*#__PURE__*/




    React.createElement(FilterButton, {
      active: coverageFilter === COVERAGE.FULLY_CLOSED,
      onClick: () => setCoverageFilter(coverageFilter === COVERAGE.FULLY_CLOSED ? null : COVERAGE.FULLY_CLOSED) }, "Fully closed")),





    tab === TAB_OPEN ? /*#__PURE__*/
    React.createElement("div", { className: "mt-2 flex items-center justify-between rounded-2xl border bg-slate-50 p-3" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Include coverage gaps in Open default"), /*#__PURE__*/
    React.createElement("div", { className: "mt-0.5 text-xs text-slate-500" }, "Show users with zero assignments alongside open items.")), /*#__PURE__*/

    React.createElement(Toggle, { checked: includeCoverageGapsInOpenDefault, onChange: setIncludeCoverageGapsInOpenDefault })) :

    null), /*#__PURE__*/



    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Learning type"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 space-y-2" }, /*#__PURE__*/
    React.createElement(ToggleRow, {
      label: "Annual training",
      checked: typeFilter[LEARNING_TYPE.ANNUAL],
      onChange: v => setTypeFilter(p => ({ ...p, [LEARNING_TYPE.ANNUAL]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Self-enrolled",
      checked: typeFilter[LEARNING_TYPE.SELF],
      onChange: v => setTypeFilter(p => ({ ...p, [LEARNING_TYPE.SELF]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Live events",
      checked: typeFilter[LEARNING_TYPE.LIVE],
      onChange: v => setTypeFilter(p => ({ ...p, [LEARNING_TYPE.LIVE]: v })) }))), /*#__PURE__*/





    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Learning container"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 space-y-2" }, /*#__PURE__*/
    React.createElement(ToggleRow, {
      label: "Courses",
      checked: containerFilter[CONTAINER.COURSE],
      onChange: v => setContainerFilter(p => ({ ...p, [CONTAINER.COURSE]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Plans",
      checked: containerFilter[CONTAINER.PLAN],
      onChange: v => setContainerFilter(p => ({ ...p, [CONTAINER.PLAN]: v })) }))), /*#__PURE__*/





    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Status"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 space-y-2" },
    tab === TAB_OPEN ? /*#__PURE__*/
    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(ToggleRow, {
      label: "Not started",
      checked: statusFilterOpen[STATUS_OPEN.NOT_STARTED],
      onChange: v => setStatusFilterOpen(p => ({ ...p, [STATUS_OPEN.NOT_STARTED]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "In progress",
      checked: statusFilterOpen[STATUS_OPEN.IN_PROGRESS],
      onChange: v => setStatusFilterOpen(p => ({ ...p, [STATUS_OPEN.IN_PROGRESS]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Due soon",
      checked: statusFilterOpen[STATUS_OPEN.DUE_SOON],
      onChange: v => setStatusFilterOpen(p => ({ ...p, [STATUS_OPEN.DUE_SOON]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Overdue",
      checked: statusFilterOpen[STATUS_OPEN.OVERDUE],
      onChange: v => setStatusFilterOpen(p => ({ ...p, [STATUS_OPEN.OVERDUE]: v })) })) : /*#__PURE__*/



    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement(ToggleRow, {
      label: "Completed on time",
      checked: statusFilterClosed[STATUS_CLOSED.COMPLETED_ON_TIME],
      onChange: v => setStatusFilterClosed(p => ({ ...p, [STATUS_CLOSED.COMPLETED_ON_TIME]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Completed late",
      checked: statusFilterClosed[STATUS_CLOSED.COMPLETED_LATE],
      onChange: v => setStatusFilterClosed(p => ({ ...p, [STATUS_CLOSED.COMPLETED_LATE]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Exempt",
      checked: statusFilterClosed[STATUS_CLOSED.EXEMPT],
      onChange: v => setStatusFilterClosed(p => ({ ...p, [STATUS_CLOSED.EXEMPT]: v })) }), /*#__PURE__*/

    React.createElement(ToggleRow, {
      label: "Marked complete",
      checked: statusFilterClosed[STATUS_CLOSED.MARKED_COMPLETE],
      onChange: v => setStatusFilterClosed(p => ({ ...p, [STATUS_CLOSED.MARKED_COMPLETE]: v })) })))), /*#__PURE__*/







    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "Date ranges"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 space-y-2" }, /*#__PURE__*/
    React.createElement(DateRow, {
      label: "Assigned",
      start: dateFilter.assignedStart,
      end: dateFilter.assignedEnd,
      onChange: next => setDateFilter(p => ({ ...p, assignedStart: next.start, assignedEnd: next.end })) }),

    tab === TAB_OPEN ? /*#__PURE__*/
    React.createElement(DateRow, {
      label: "Due",
      start: dateFilter.dueStart,
      end: dateFilter.dueEnd,
      onChange: next => setDateFilter(p => ({ ...p, dueStart: next.start, dueEnd: next.end })) }) : /*#__PURE__*/


    React.createElement(DateRow, {
      label: "Completed",
      start: dateFilter.completedStart,
      end: dateFilter.completedEnd,
      onChange: (next) =>
      setDateFilter(p => ({ ...p, completedStart: next.start, completedEnd: next.end })) }))))));








}

function FilterButton({ active, onClick, children }) {
  return /*#__PURE__*/(
    React.createElement("button", {
      type: "button",
      onClick: onClick,
      className: "rounded-xl border px-3 py-2 text-left text-sm font-medium " + (active ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50") },

    children));


}

function ToggleRow({ label, checked, onChange }) {
  return /*#__PURE__*/(
    React.createElement("div", { className: "flex items-center justify-between rounded-2xl border bg-white p-3" }, /*#__PURE__*/
    React.createElement("div", { className: "text-sm" }, label), /*#__PURE__*/
    React.createElement(Toggle, { checked: checked, onChange: onChange })));


}

function DateRow({ label, start, end, onChange }) {
  return /*#__PURE__*/(
    React.createElement("div", { className: "rounded-2xl border bg-white p-3" }, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, label), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 grid grid-cols-2 gap-2" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs text-slate-500" }, "Start"), /*#__PURE__*/
    React.createElement("input", {
      type: "date",
      value: start,
      onChange: e => onChange({ start: e.target.value, end }),
      className: "mt-1 w-full rounded-xl border px-3 py-2 text-sm" })), /*#__PURE__*/


    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs text-slate-500" }, "End"), /*#__PURE__*/
    React.createElement("input", {
      type: "date",
      value: end,
      onChange: e => onChange({ start, end: e.target.value }),
      className: "mt-1 w-full rounded-xl border px-3 py-2 text-sm" })))));





}

// -----------------------------
// Roster Table
// -----------------------------

function RosterTable({
  tab,
  rows,
  selectedUserIds,
  allVisibleSelected,
  onToggleSelectAll,
  onToggleSelectUser,
  onOpenDetails,
  onQuickAction,
  onAssign })
{
  const showOpenCol = tab === TAB_OPEN;

  // Indeterminate header checkbox when some visible rows are selected
  const headerRef = useRef(null);
  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    for (const r of rows) if (selectedUserIds.has(r.user.id)) count++;
    return count;
  }, [rows, selectedUserIds]);

  useEffect(() => {
    if (!headerRef.current) return;
    headerRef.current.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < rows.length;
  }, [visibleSelectedCount, rows.length]);

  if (!rows.length) {
    return /*#__PURE__*/(
      React.createElement(Card, null, /*#__PURE__*/
      React.createElement(CardHeader, { title: "Roster", subtitle: "No matching users" }), /*#__PURE__*/
      React.createElement(CardContent, null, /*#__PURE__*/
      React.createElement("div", { className: "rounded-2xl border bg-slate-50 p-6 text-center" }, /*#__PURE__*/
      React.createElement("div", { className: "text-sm font-semibold" }, "No results"), /*#__PURE__*/
      React.createElement("div", { className: "mt-1 text-xs text-slate-500" }, "Try clearing filters or changing the search.")))));




  }

  return /*#__PURE__*/(
    React.createElement(Card, null, /*#__PURE__*/
    React.createElement(CardHeader, { title: "Roster", subtitle: tab === TAB_OPEN ? "Open items + coverage gaps" : "Closed items for context/audit" }), /*#__PURE__*/
    React.createElement(CardContent, null, /*#__PURE__*/
    React.createElement("div", { className: "overflow-x-auto" }, /*#__PURE__*/
    React.createElement("table", { className: "w-full border-separate border-spacing-0 text-sm" }, /*#__PURE__*/
    React.createElement("thead", null, /*#__PURE__*/
    React.createElement("tr", { className: "text-left text-xs text-slate-500" }, /*#__PURE__*/
    React.createElement("th", { className: "w-10 rounded-tl-xl border-b bg-slate-50 px-3 py-2" }, /*#__PURE__*/
    React.createElement("input", {
      ref: headerRef,
      type: "checkbox",
      checked: allVisibleSelected,
      onChange: e => onToggleSelectAll(e.target.checked),
      "aria-label": "Select all visible users" })), /*#__PURE__*/


    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2" }, "Name"), /*#__PURE__*/
    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2" }, "Role"), /*#__PURE__*/
    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2" }, "Department"), /*#__PURE__*/
    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2" }, "Manager"), /*#__PURE__*/
    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2 text-right" }, "Assigned"),
    showOpenCol ? /*#__PURE__*/React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2 text-right" }, "Open") : null,
    showOpenCol ? /*#__PURE__*/React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2" }, "Priority") : null, /*#__PURE__*/
    React.createElement("th", { className: "border-b bg-slate-50 px-3 py-2 text-right" }, "On-time"), /*#__PURE__*/
    React.createElement("th", { className: "rounded-tr-xl border-b bg-slate-50 px-3 py-2 text-right" }, "Actions"))), /*#__PURE__*/


    React.createElement("tbody", null,
    rows.map(r => {
      const checked = selectedUserIds.has(r.user.id);
      return /*#__PURE__*/(
        React.createElement("tr", { key: r.user.id, className: "hover:bg-slate-50" }, /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3" }, /*#__PURE__*/
        React.createElement("input", {
          type: "checkbox",
          checked: checked,
          onChange: e => onToggleSelectUser(r.user.id, e.target.checked),
          "aria-label": `Select ${r.user.name}` })), /*#__PURE__*/


        React.createElement("td", { className: "border-b px-3 py-3" }, /*#__PURE__*/
        React.createElement("button", { type: "button", onClick: () => onOpenDetails(r.user.id), className: "text-left" }, /*#__PURE__*/
        React.createElement("div", { className: "font-semibold text-slate-900 hover:underline" }, r.user.name),
        r.assignedCount === 0 ? /*#__PURE__*/
        React.createElement("div", { className: "mt-1" }, /*#__PURE__*/
        React.createElement("span", { className: pillClass("danger") }, "No assignments")) :

        null)), /*#__PURE__*/


        React.createElement("td", { className: "border-b px-3 py-3 text-slate-700" }, r.user.role), /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3 text-slate-700" }, r.user.department), /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3 text-slate-700" }, r.user.manager), /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3 text-right tabular-nums" }, r.assignedCount),
        showOpenCol ? /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3 text-right tabular-nums" }, /*#__PURE__*/
        React.createElement("span", { className: r.openItemsFiltered.length > 0 ? "font-semibold" : "text-slate-500" },
        r.openItemsFiltered.length)) :


        null,
        showOpenCol ? /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3" }, /*#__PURE__*/
        React.createElement("div", { className: "flex flex-wrap gap-2" }, /*#__PURE__*/
        React.createElement("span", { className: r.overdueCount > 0 ? pillClass("danger") : pillClass("muted") }, "Overdue: ",
        r.overdueCount), /*#__PURE__*/

        React.createElement("span", { className: r.dueSoonCount > 0 ? pillClass("warn") : pillClass("muted") }, "Due soon: ",
        r.dueSoonCount))) :



        null, /*#__PURE__*/
        React.createElement("td", { className: "border-b px-3 py-3 text-right tabular-nums" }, /*#__PURE__*/
        React.createElement("span", { className: r.onTimeCount > 0 ? "" : "text-slate-500" }, r.onTimeCount)), /*#__PURE__*/

        React.createElement("td", { className: "border-b px-3 py-3 text-right" }, /*#__PURE__*/
        React.createElement("div", { className: "inline-flex flex-wrap justify-end gap-2" }, /*#__PURE__*/
        React.createElement(SecondaryButton, { onClick: () => onQuickAction("send_reminder", r.user.id) }, "\uD83D\uDD14"), /*#__PURE__*/
        React.createElement(SecondaryButton, { onClick: () => onQuickAction("escalate_to_manager", r.user.id) }, "\uD83D\uDEE1\uFE0F"), /*#__PURE__*/
        React.createElement(SecondaryButton, { onClick: () => onAssign(r.user.id) }, "\u2795"), /*#__PURE__*/
        React.createElement(SecondaryButton, { onClick: () => onOpenDetails(r.user.id) }, "Details")))));




    })))))));






}

// -----------------------------
// Details Panel
// -----------------------------

function DetailsPanel({
  tab,
  user,
  items,
  courses,
  plans,
  detailSubtab,
  setDetailSubtab,
  onClose,
  onAssign,
  onMarkComplete,
  onExempt,
  audit })
{
  const openItems = items.filter(it => isOpenStatus(it.status));
  const closedItems = items.filter(it => isClosedStatus(it.status));

  const list = detailSubtab === CONTAINER.COURSE ? courses : plans;

  return /*#__PURE__*/(
    React.createElement("div", { className: "sticky top-[108px]" }, /*#__PURE__*/
    React.createElement(Card, null, /*#__PURE__*/
    React.createElement(CardHeader, {
      title: user.name,
      subtitle: `${user.role} • ${user.department} • Manager: ${user.manager}`,
      right: /*#__PURE__*/
      React.createElement("div", { className: "flex items-center gap-2" }, /*#__PURE__*/
      React.createElement(SecondaryButton, { onClick: onAssign }, "\u2795 Assign"), /*#__PURE__*/
      React.createElement(GhostButton, { onClick: onClose }, "Close")) }), /*#__PURE__*/



    React.createElement(CardContent, null, /*#__PURE__*/
    React.createElement("div", { className: "flex flex-wrap gap-2" }, /*#__PURE__*/
    React.createElement("span", { className: pillClass("outline") }, "Assigned: ", items.length), /*#__PURE__*/
    React.createElement("span", { className: pillClass(openItems.length > 0 ? "danger" : "muted") }, "Open: ", openItems.length), /*#__PURE__*/
    React.createElement("span", { className: pillClass(tab === TAB_CLOSED ? "good" : "muted") }, "Closed: ", closedItems.length),
    items.length === 0 ? /*#__PURE__*/React.createElement("span", { className: pillClass("danger") }, "Coverage gap") : null), /*#__PURE__*/


    React.createElement("div", { className: "mt-4 inline-flex w-full rounded-2xl border bg-white p-1" }, /*#__PURE__*/
    React.createElement("button", {
      type: "button",
      onClick: () => setDetailSubtab(CONTAINER.COURSE),
      className:
      "flex-1 rounded-2xl px-3 py-2 text-sm font-medium " + (
      detailSubtab === CONTAINER.COURSE ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50") }, "Courses (",


    courses.length, ")"), /*#__PURE__*/

    React.createElement("button", {
      type: "button",
      onClick: () => setDetailSubtab(CONTAINER.PLAN),
      className:
      "flex-1 rounded-2xl px-3 py-2 text-sm font-medium " + (
      detailSubtab === CONTAINER.PLAN ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50") }, "Plans (",


    plans.length, ")")), /*#__PURE__*/



    React.createElement("div", { className: "mt-4 space-y-3" },
    list.length === 0 ? /*#__PURE__*/
    React.createElement("div", { className: "rounded-2xl border bg-slate-50 p-6 text-center" }, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "No items"), /*#__PURE__*/
    React.createElement("div", { className: "mt-1 text-xs text-slate-500" }, "Nothing in this container.")) :


    list.
    slice().
    sort((a, b) => {
      const aOpen = isOpenStatus(a.status);
      const bOpen = isOpenStatus(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      const ap = aOpen ? priorityScoreForOpenItem(a) : 0;
      const bp = bOpen ? priorityScoreForOpenItem(b) : 0;
      if (bp !== ap) return bp - ap;
      const ad = a.dueDate || "9999-12-31";
      const bd = b.dueDate || "9999-12-31";
      if (ad !== bd) return ad.localeCompare(bd);
      return a.name.localeCompare(b.name);
    }).
    map(it => {
      const open = isOpenStatus(it.status);
      const s = open ? effectiveStatus(it) : it.status;
      return /*#__PURE__*/(
        React.createElement("div", { key: it.id, className: "rounded-2xl border bg-white p-4" }, /*#__PURE__*/
        React.createElement("div", { className: "flex items-start justify-between gap-3" }, /*#__PURE__*/
        React.createElement("div", { className: "min-w-0" }, /*#__PURE__*/
        React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /*#__PURE__*/
        React.createElement("div", { className: "font-semibold text-slate-900" }, it.name), /*#__PURE__*/
        React.createElement("span", { className: pillClass("outline") }, it.container === CONTAINER.COURSE ? "Course" : "Plan"), /*#__PURE__*/
        React.createElement("span", { className: pillClass("muted") },
        it.type === LEARNING_TYPE.ANNUAL ? "Annual" : it.type === LEARNING_TYPE.SELF ? "Self-enrolled" : "Live event"), /*#__PURE__*/

        React.createElement("span", { className: statusPill(s) }, statusLabel(s))), /*#__PURE__*/

        React.createElement("div", { className: "mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-3" }, /*#__PURE__*/
        React.createElement(Meta, { label: "Assigned", value: it.assignedDate || "—" }), /*#__PURE__*/
        React.createElement(Meta, { label: "Due", value: it.dueDate || "—" }), /*#__PURE__*/
        React.createElement(Meta, { label: "Completed", value: it.completionDate || "—" }))), /*#__PURE__*/



        React.createElement("div", { className: "flex flex-col items-end gap-2" },
        open ? /*#__PURE__*/
        React.createElement(React.Fragment, null, /*#__PURE__*/
        React.createElement(PrimaryButton, { onClick: () => onMarkComplete(it.id) }, "\u2705 Mark complete"), /*#__PURE__*/
        React.createElement(SecondaryButton, { onClick: () => onExempt(it.id) }, "\u26D4 Exempt")) : /*#__PURE__*/


        React.createElement("span", { className: pillClass("muted") }, "No action")))));





    })), /*#__PURE__*/



    React.createElement("div", { className: "my-5 h-px bg-slate-200" }), /*#__PURE__*/

    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, "User audit (latest)"), /*#__PURE__*/
    React.createElement("div", { className: "mt-2 max-h-[220px] overflow-auto rounded-2xl border bg-white p-3" },
    audit.length === 0 ? /*#__PURE__*/
    React.createElement("div", { className: "text-sm text-slate-600" }, "No actions logged for this user yet.") : /*#__PURE__*/

    React.createElement("div", { className: "space-y-2" },
    audit.map((a) => /*#__PURE__*/
    React.createElement("div", { key: a.id, className: "rounded-2xl border bg-white p-3" }, /*#__PURE__*/
    React.createElement("div", { className: "flex items-center justify-between gap-2" }, /*#__PURE__*/
    React.createElement("div", { className: "text-sm font-semibold" }, String(a.action || "").replaceAll("_", " ")), /*#__PURE__*/
    React.createElement("div", { className: "text-xs text-slate-500" }, new Date(a.ts).toLocaleString())), /*#__PURE__*/

    React.createElement("div", { className: "mt-1 text-xs text-slate-600" }, /*#__PURE__*/
    React.createElement("span", { className: "font-semibold" }, "Actor:"), " ", a.actor, /*#__PURE__*/
    React.createElement("span", { className: "mx-2" }, "\u2022"), /*#__PURE__*/
    React.createElement("span", { className: "font-semibold" }, "Reason:"), " ", reasonLabel(a.reason)),

    a.note ? /*#__PURE__*/React.createElement("div", { className: "mt-1 text-xs text-slate-600" }, a.note) : null)))))))));










}

function Meta({ label, value }) {
  return /*#__PURE__*/(
    React.createElement("div", { className: "rounded-2xl border bg-slate-50 p-2" }, /*#__PURE__*/
    React.createElement("div", { className: "text-[10px] font-semibold uppercase tracking-wide text-slate-500" }, label), /*#__PURE__*/
    React.createElement("div", { className: "mt-0.5 font-semibold tabular-nums text-slate-800" }, value)));


}

// -----------------------------
// Assign Modal
// -----------------------------

function AssignModal({ open, onClose, onAssign, targetCount }) {
  const [container, setContainer] = useState(CONTAINER.COURSE);
  const [type, setType] = useState(LEARNING_TYPE.ANNUAL);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");

  const canSubmit = name.trim().length > 2;

  return /*#__PURE__*/(
    React.createElement(Modal, {
      open: open,
      title: `Assign learning (${targetCount} user${targetCount === 1 ? "" : "s"})`,
      onClose: onClose,
      footer: /*#__PURE__*/
      React.createElement("div", { className: "flex items-center justify-end gap-2" }, /*#__PURE__*/
      React.createElement(GhostButton, { onClick: onClose }, "Cancel"), /*#__PURE__*/
      React.createElement(PrimaryButton, {
        disabled: !canSubmit,
        onClick: () => {
          onAssign({ container, type, name: name.trim(), dueDate: dueDate || null });
          setName("");
          setDueDate("");
        } }, "Assign")) }, /*#__PURE__*/






    React.createElement("div", { className: "space-y-4" }, /*#__PURE__*/
    React.createElement("div", { className: "grid grid-cols-2 gap-3" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Container"), /*#__PURE__*/
    React.createElement("select", {
      value: container,
      onChange: e => setContainer(e.target.value),
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" }, /*#__PURE__*/

    React.createElement("option", { value: CONTAINER.COURSE }, "Course"), /*#__PURE__*/
    React.createElement("option", { value: CONTAINER.PLAN }, "Plan"))), /*#__PURE__*/


    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Type"), /*#__PURE__*/
    React.createElement("select", {
      value: type,
      onChange: e => setType(e.target.value),
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" }, /*#__PURE__*/

    React.createElement("option", { value: LEARNING_TYPE.ANNUAL }, "Annual training"), /*#__PURE__*/
    React.createElement("option", { value: LEARNING_TYPE.SELF }, "Self-enrolled"), /*#__PURE__*/
    React.createElement("option", { value: LEARNING_TYPE.LIVE }, "Live event")))), /*#__PURE__*/




    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Name"), /*#__PURE__*/
    React.createElement("input", {
      value: name,
      onChange: e => setName(e.target.value),
      placeholder: "e.g., Annual Fire Safety",
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" })), /*#__PURE__*/



    React.createElement("div", null, /*#__PURE__*/
    React.createElement("div", { className: "text-xs font-semibold text-slate-700" }, "Due date (optional)"), /*#__PURE__*/
    React.createElement("input", {
      type: "date",
      value: dueDate,
      onChange: e => setDueDate(e.target.value),
      className: "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" }), /*#__PURE__*/

    React.createElement("div", { className: "mt-1 text-xs text-slate-500" }, "If omitted, completion is treated as on-time for display.")))));




}

// Boot
ReactDOM.createRoot(document.getElementById("root")).render( /*#__PURE__*/React.createElement(App, null));