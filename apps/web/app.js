import { loadState, saveState, createId } from './localStore.js';
import {
  loadLocalData,
  saveLocalData,
  recordLocalChange,
  getBootLocalData,
  prepareLocalDataForStorage
} from './localData.js';
import { applyRemoteChanges } from './syncState.js';
import { replayPendingChanges } from './syncQueue.js';
import { getClientId } from './clientId.js';
import { suppressQuickAddPointerEvents } from './quickAdd.js';
import { showToast } from './ui/toast.js';
import * as api from './api.js';
import { compareTasksByPriority } from '../../packages/core/priority.js';
import { reparent as reparentTasks } from '../../packages/core/tree.js';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../packages/core/taskState.js';

const DEFAULT_OWNER_EMAIL = 'brian@pipecaminc.com';

const localData = loadLocalData();
const bootLocalData = getBootLocalData(localData);
const state = {
  ...loadState(),
  workspaces: (bootLocalData.workspaces ?? []).map(normalizeWorkspace),
  workspace: null,
  projects: bootLocalData.projects ?? [],
  templates: bootLocalData.templates ?? [],
  workflows: bootLocalData.workflows ?? [],
  workflowVariants: bootLocalData.workflowVariants ?? [],
  workflowPhases: bootLocalData.workflowPhases ?? [],
  workflowVariantPhases: bootLocalData.workflowVariantPhases ?? [],
  workflowPhaseTasks: bootLocalData.workflowPhaseTasks ?? [],
  workflowPatterns: bootLocalData.workflowPatterns ?? bootLocalData.workflowFragments ?? [],
  workflowPatternTasks: bootLocalData.workflowPatternTasks ?? bootLocalData.workflowFragmentTasks ?? [],
  workflowInstances: bootLocalData.workflowInstances ?? [],
  workflowInstanceTasks: bootLocalData.workflowInstanceTasks ?? [],
  scheduleCalendars: bootLocalData.scheduleCalendars ?? [],
  scheduleEventTypes: bootLocalData.scheduleEventTypes ?? [],
  scheduleEvents: bootLocalData.scheduleEvents ?? [],
  statuses: bootLocalData.statuses ?? [],
  taskTypes: bootLocalData.taskTypes ?? [],
  users: bootLocalData.users ?? [],
  workspaceMemberships: bootLocalData.workspaceMemberships ?? [],
  taskSections: (bootLocalData.taskSections ?? []).map(normalizeTaskSection),
  storeRules: bootLocalData.storeRules ?? [],
  tasks: bootLocalData.tasks ?? {},
  taskDependencies: bootLocalData.taskDependencies ?? [],
  notices: bootLocalData.notices ?? [],
  noticeTypes: bootLocalData.noticeTypes ?? [],
  shoppingLists: bootLocalData.shoppingLists ?? [],
  shoppingItems: bootLocalData.shoppingItems ?? {},
  auditLog: bootLocalData.auditLog ?? [],
  local: {
    localSeq: localData.localSeq ?? 0,
    pendingChanges: localData.pendingChanges ?? []
  }
};
const cachedPreferredWorkspaceId = state.ui?.activeWorkspaceId;
state.workspace = state.workspaces.find(ws => ws.id === cachedPreferredWorkspaceId && !ws.archived)
  ?? state.workspaces.find(ws => !ws.archived)
  ?? state.workspaces[0]
  ?? null;
state.ui = state.ui ?? {};
state.ui.forceAuthGate = Boolean(state.ui.forceAuthGate);
// Never trust persisted auth flags across refresh; hydrate from /auth/me + cookie each boot.
state.ui.auth = {
  authenticated: false,
  requireAuth: Boolean(state.ui.auth?.requireAuth),
  user: null,
  session: null,
  workspaces: [],
  ownerEmail: String(state.ui.auth?.ownerEmail ?? DEFAULT_OWNER_EMAIL).trim().toLowerCase() || DEFAULT_OWNER_EMAIL,
  isOwner: false,
  isAdmin: false
};
const DEFAULT_NOTICE_TYPES = [
  { key: 'general', label: 'General' },
  { key: 'bill', label: 'Bill notice' },
  { key: 'auto-payment', label: 'Auto-payment notice' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'holiday', label: 'Holiday' }
];
const NOTICE_TYPE_BIRTHDAY = 'birthday';
const DEFAULT_STATUS_DEFS = [
  { key: TaskStatus.INBOX, label: 'Inbox', kind: TaskStatus.INBOX, sort_order: 10, kanban_visible: 0 },
  { key: TaskStatus.PLANNED, label: 'Planned', kind: TaskStatus.PLANNED, sort_order: 20, kanban_visible: 0 },
  { key: TaskStatus.IN_PROGRESS, label: 'In Progress', kind: TaskStatus.IN_PROGRESS, sort_order: 30, kanban_visible: 0 },
  { key: TaskStatus.WAITING, label: 'Waiting', kind: TaskStatus.WAITING, sort_order: 40, kanban_visible: 0 },
  { key: TaskStatus.BLOCKED, label: 'Blocked', kind: TaskStatus.BLOCKED, sort_order: 50, kanban_visible: 0 },
  { key: TaskStatus.DONE, label: 'Done', kind: TaskStatus.DONE, sort_order: 60, kanban_visible: 0 },
  { key: TaskStatus.CANCELED, label: 'Canceled', kind: TaskStatus.CANCELED, sort_order: 70, kanban_visible: 0 }
];
const DEFAULT_TASK_TYPE_DEFS = [
  { name: 'General', is_default: 1 },
  { name: 'Bill Due', is_default: 1 }
];
const DEFAULT_SCHEDULE_EVENT_TYPE_DEFS = [
  { name: 'General', description_template: '', default_color: '#63b3ed' }
];
const DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES = 10;
const DEFAULT_SCHEDULE_EVENT_DURATION_MINUTES = 60;
const MIN_SCHEDULE_EVENT_DURATION_MINUTES = 5;
const MAX_SCHEDULE_EVENT_DURATION_MINUTES = 1440;
const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const TASK_FILTER_UNASSIGNED = 'unassigned';
const TASK_FILTER_INBOX = '__inbox__';
const PROJECT_KIND_PROJECT = 'project';
const PROJECT_KIND_LIST = 'list';
const TASK_TYPE_WORKFLOW = 'workflow';
const SHOPPING_INBOX_NAME = 'Shopping Inbox';
const SHOPPING_KEYWORD_STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'from', 'into', 'onto', 'your', 'our',
  'of', 'to', 'in', 'on', 'at', 'a', 'an', 'oz', 'lb', 'lbs', 'pkg', 'pack'
]);
const SETTINGS_TAB_KEYS = new Set(['general', 'tasks', 'scheduling', 'crm', 'knowledge']);
const SCHEDULING_EVENT_KINDS = ['event', 'time-block', 'day-off'];
const SCHEDULE_CALENDAR_COLOR_PALETTE = Object.freeze([
  '#63b3ed',
  '#9061f9',
  '#fa5252',
  '#51cf66',
  '#f59f00',
  '#f783ac',
  '#4dabf7',
  '#20c997'
]);
const SCHEDULE_EVENT_COLOR_PRESET_PALETTE = Object.freeze([
  '#63b3ed', '#4dabf7', '#3b82f6', '#0ea5e9',
  '#20c997', '#22c55e', '#84cc16', '#f59f00',
  '#f97316', '#fa5252', '#fb7185', '#f783ac',
  '#d946ef', '#a78bfa', '#9061f9', '#64748b'
]);
const US_HOLIDAY_RULES = Object.freeze([
  { key: 'new-years-day', title: "New Year's Day", getDate: (year) => new Date(year, 0, 1, 12, 0, 0, 0) },
  { key: 'chinese-new-year', title: 'Chinese New Year', getDate: (year) => getChineseNewYearDate(year) },
  { key: 'martin-luther-king-jr-day', title: 'Martin Luther King Jr. Day', getDate: (year) => getNthWeekdayOfMonth(year, 0, 1, 3) },
  { key: 'presidents-day', title: "Presidents' Day", getDate: (year) => getNthWeekdayOfMonth(year, 1, 1, 3) },
  { key: 'memorial-day', title: 'Memorial Day', getDate: (year) => getLastWeekdayOfMonth(year, 4, 1) },
  { key: 'juneteenth', title: 'Juneteenth', getDate: (year) => new Date(year, 5, 19, 12, 0, 0, 0) },
  { key: 'independence-day', title: 'Independence Day', getDate: (year) => new Date(year, 6, 4, 12, 0, 0, 0) },
  { key: 'labor-day', title: 'Labor Day', getDate: (year) => getNthWeekdayOfMonth(year, 8, 1, 1) },
  { key: 'columbus-day', title: 'Columbus Day', getDate: (year) => getNthWeekdayOfMonth(year, 9, 1, 2) },
  { key: 'veterans-day', title: 'Veterans Day', getDate: (year) => new Date(year, 10, 11, 12, 0, 0, 0) },
  { key: 'thanksgiving', title: 'Thanksgiving', getDate: (year) => getNthWeekdayOfMonth(year, 10, 4, 4) },
  { key: 'christmas-day', title: 'Christmas Day', getDate: (year) => new Date(year, 11, 25, 12, 0, 0, 0) }
]);
const US_HOLIDAY_RULE_KEYS = new Set(US_HOLIDAY_RULES.map(rule => rule.key));
const CHINESE_CALENDAR_FORMATTER = (() => {
  try {
    return new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' });
  } catch {
    return null;
  }
})();

function normalizeTitleInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeTaskStatusValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeTagList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(',');
  const seen = new Set();
  const tags = [];
  source.forEach((entry) => {
    const tag = String(entry ?? '').trim();
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function formatTagList(tags) {
  return normalizeTagList(tags).join(', ');
}

function areTagListsEqual(a, b) {
  const left = normalizeTagList(a).map(tag => tag.toLowerCase()).sort();
  const right = normalizeTagList(b).map(tag => tag.toLowerCase()).sort();
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}
const taskTreeEl = document.getElementById('task-tree');
const taskFilterButton = document.getElementById('task-filter-button');
const taskFilterMenu = document.getElementById('task-filter-menu');
const taskFilterSearchInput = document.getElementById('task-filter-search-input');
const taskFilterTagInput = document.getElementById('task-filter-tag-input');
const taskCreatePrimary = document.getElementById('task-create-primary');
const taskCreateMenuButton = document.getElementById('task-create-menu-button');
const taskCreateMenu = document.getElementById('task-create-menu');
const tasksMobileAddBtn = document.getElementById('tasks-mobile-add-btn');
const taskAiButton = document.getElementById('task-ai-button');
const taskAiMenu = document.getElementById('task-ai-menu');
const taskSortButton = document.getElementById('task-sort-button');
const taskSortMenu = document.getElementById('task-sort-menu');
const taskGroupButton = document.getElementById('task-group-button');
const taskGroupMenu = document.getElementById('task-group-menu');
const taskViewSelect = document.getElementById('task-view-select');
const taskColumnsButton = document.getElementById('task-columns-button');
const taskShoppingInbox = document.getElementById('task-shopping-inbox');
const taskShoppingInboxInput = document.getElementById('task-shopping-inbox-input');
const taskShoppingInboxAdd = document.getElementById('task-shopping-inbox-add');
const taskBulkBar = document.getElementById('task-bulk-bar');
const taskBulkCount = document.getElementById('task-bulk-count');
const taskBulkEditBtn = document.getElementById('task-bulk-edit');
const taskBulkDeleteBtn = document.getElementById('task-bulk-delete');
const taskBulkClearBtn = document.getElementById('task-bulk-clear');
const taskBulkUndoButton = document.getElementById('task-bulk-undo-button');
const taskBulkUndoMenu = document.getElementById('task-bulk-undo-menu');
const taskContextMenu = document.getElementById('task-context-menu');
const taskColumnsModal = document.getElementById('task-columns-modal');
const taskColumnsList = document.getElementById('task-columns-list');
const taskColumnName = document.getElementById('task-column-name');
const taskColumnAdd = document.getElementById('task-column-add');
const taskColumnsClose = document.getElementById('task-columns-close');
const kanbanColumnModal = document.getElementById('kanban-column-modal');
const kanbanColumnForm = document.getElementById('kanban-column-form');
const kanbanColumnName = document.getElementById('kanban-column-name');
const kanbanColumnCancel = document.getElementById('kanban-column-cancel');
const workspaceListEl = document.getElementById('workspace-list');
const workspaceDropdownButton = document.getElementById('workspace-dropdown-button');
const workspaceMenuButton = document.getElementById('workspace-menu-button');
const workspaceMenu = document.getElementById('workspace-menu');
const manageWorkspacesBtn = document.getElementById('manage-workspaces-btn');
const archivedWorkspacesBtn = document.getElementById('archived-workspaces-btn');
const enableNotificationsBtn = document.getElementById('enable-notifications');
const notificationStatus = document.getElementById('notification-status');
const templateListEl = document.getElementById('template-list');
const newTemplateBtn = document.getElementById('new-template-btn');
const teamMemberNameInput = document.getElementById('team-member-name');
const teamMemberEmailInput = document.getElementById('team-member-email');
const teamMemberRoleSelect = document.getElementById('team-member-role');
const teamMemberAddBtn = document.getElementById('team-member-add');
const teamMemberListEl = document.getElementById('team-member-list');
const taskTypeListEl = document.getElementById('task-type-list');
const taskTypeNameInput = document.getElementById('task-type-name');
const taskTypeAddBtn = document.getElementById('task-type-add');
const storeRuleListEl = document.getElementById('store-rule-list');
const storeRuleNameInput = document.getElementById('store-rule-name');
const storeRuleKeywordsInput = document.getElementById('store-rule-keywords');
const storeRuleAddBtn = document.getElementById('store-rule-add');
const projectListEl = document.getElementById('project-list');
const taskListListEl = document.getElementById('task-list-list');
const newTaskListBtn = document.getElementById('new-task-list-btn');
const newProjectBtn = document.getElementById('new-project-btn');
const projectsOpenBtn = document.getElementById('projects-open');
const tasksOpenBtn = document.getElementById('tasks-open');
const workflowsOpenBtn = document.getElementById('workflows-open');
const workflowListEl = document.getElementById('workflow-list');
const newWorkflowBtn = document.getElementById('new-workflow-btn');
const workflowSidebarMenuButton = document.getElementById('workflow-sidebar-menu-button');
const workflowSidebarMenu = document.getElementById('workflow-sidebar-menu');
const workflowSidebarManage = document.getElementById('workflow-sidebar-manage');
const shoppingListListEl = document.getElementById('shopping-list-list');
const shoppingOpenBtn = document.getElementById('shopping-open');
const newShoppingListBtn = document.getElementById('new-shopping-list-btn');
const noticeListEl = document.getElementById('notice-list');
const newNoticeSidebarBtn = document.getElementById('new-notice-sidebar-btn');
const noticesOpenBtn = document.getElementById('notices-open');
const noticesPage = document.getElementById('notices-page');
const workflowsPage = document.getElementById('workflows-page');
const dataTransferPage = document.getElementById('data-transfer-page');
const auditLogPage = document.getElementById('audit-log-page');
const automationPage = document.getElementById('automation-page');
const helpPage = document.getElementById('help-page');
const adminPage = document.getElementById('admin-page');
const profilePage = document.getElementById('profile-page');
const workflowPageTitle = document.getElementById('workflow-page-title');
const workflowPageSubtitle = document.getElementById('workflow-page-subtitle');
const workflowMenuButton = document.getElementById('workflow-menu-button');
const workflowMenu = document.getElementById('workflow-menu');
const workflowRenameBtn = document.getElementById('workflow-rename');
const workflowDeleteBtn = document.getElementById('workflow-delete');
const workflowInstanceAddBtn = document.getElementById('workflow-instance-add');
const workflowDetailEl = document.getElementById('workflow-detail');
const noticesListEl = document.getElementById('notices-list');
const noticesAddBtn = document.getElementById('notices-add-btn');
const noticeFilterButton = document.getElementById('notice-filter-button');
const noticeFilterMenu = document.getElementById('notice-filter-menu');
const noticeSortButton = document.getElementById('notice-sort-button');
const noticeSortMenu = document.getElementById('notice-sort-menu');
const tasksPanel = document.getElementById('tasks-panel');
const schedulingPage = document.getElementById('scheduling-page');
const schedulingAddBtn = document.getElementById('scheduling-add-btn');
const schedulingCalendar = document.getElementById('scheduling-calendar');
const tasksSidebarContent = document.getElementById('tasks-sidebar-content');
const schedulingSidebarContent = document.getElementById('scheduling-sidebar-content');
const schedulingSidebarOpen = document.getElementById('scheduling-sidebar-open');
const schedulingSidebarToday = document.getElementById('scheduling-sidebar-today');
const schedulingSidebarAddEvent = document.getElementById('scheduling-sidebar-add-event');
const schedulingSidebarAddTimeBlock = document.getElementById('scheduling-sidebar-add-time-block');
const schedulingSidebarAddDayOff = document.getElementById('scheduling-sidebar-add-day-off');
const schedulingCalendarList = document.getElementById('scheduling-calendar-list');
const schedulingCalendarAdd = document.getElementById('scheduling-calendar-add');
const schedulingLayerEvent = document.getElementById('scheduling-layer-event');
const schedulingLayerTimeBlock = document.getElementById('scheduling-layer-time-block');
const schedulingLayerDayOff = document.getElementById('scheduling-layer-day-off');
const schedulingLayerTasks = document.getElementById('scheduling-layer-tasks');
const schedulingLayerHolidays = document.getElementById('scheduling-layer-holidays');
const schedulingMiniMonthPrev = document.getElementById('scheduling-mini-month-prev');
const schedulingMiniMonthNext = document.getElementById('scheduling-mini-month-next');
const schedulingMiniMonthTitle = document.getElementById('scheduling-mini-month-title');
const schedulingMiniMonthGrid = document.getElementById('scheduling-mini-month-grid');
const projectsPage = document.getElementById('projects-page');
const projectsAddBtn = document.getElementById('projects-add-btn');
const projectsMobileList = document.getElementById('projects-mobile-list');
const projectFilterButton = document.getElementById('project-filter-button');
const projectFilterMenu = document.getElementById('project-filter-menu');
const shoppingPage = document.getElementById('shopping-page');
const workspaceManagePage = document.getElementById('workspace-manage-page');
const workspaceArchivedPage = document.getElementById('workspace-archived-page');
const workspaceManageList = document.getElementById('workspace-manage-list');
const workspaceArchivedList = document.getElementById('workspace-archived-list');
const workspaceManageBack = document.getElementById('workspace-manage-back');
const workspaceArchivedBack = document.getElementById('workspace-archived-back');
const shoppingListTitle = document.getElementById('shopping-list-title');
const shoppingListSubtitle = document.getElementById('shopping-list-subtitle');
const shoppingListItemsEl = document.getElementById('shopping-list-items');
const shoppingMobileBackRow = document.getElementById('shopping-mobile-back-row');
const shoppingMobileBack = document.getElementById('shopping-mobile-back');
const shoppingAddBtn = document.getElementById('shopping-add-item');
const shoppingListSidebarMenuButton = document.getElementById('shopping-list-sidebar-menu-button');
const shoppingListSidebarMenu = document.getElementById('shopping-list-sidebar-menu');
const showArchivedShoppingToggle = document.getElementById('show-archived-shopping');
const shoppingListMenuButton = document.getElementById('shopping-list-menu-button');
const shoppingListMenu = document.getElementById('shopping-list-menu');
const shoppingFilterButton = document.getElementById('shopping-filter-button');
const shoppingFilterMenu = document.getElementById('shopping-filter-menu');
const shoppingListRename = document.getElementById('shopping-list-rename');
const shoppingListDelete = document.getElementById('shopping-list-delete');
const shoppingListModal = document.getElementById('shopping-list-modal');
const shoppingListForm = document.getElementById('shopping-list-form');
const shoppingListStoreSelect = document.getElementById('shopping-list-store-select');
const shoppingStoreModal = document.getElementById('shopping-store-modal');
const shoppingStoreForm = document.getElementById('shopping-store-form');
const shoppingStoreNameInput = document.getElementById('shopping-store-name');
const shoppingStoreCancel = document.getElementById('shopping-store-cancel');
const shoppingListDate = document.getElementById('shopping-list-date');
const shoppingListItemsInput = document.getElementById('shopping-list-items-input');
const shoppingListParse = document.getElementById('shopping-list-parse');
const shoppingListCancel = document.getElementById('shopping-list-cancel');
const shoppingCompleteBtn = document.getElementById('shopping-complete-btn');
const shoppingItemModal = document.getElementById('shopping-item-modal');
const shoppingItemForm = document.getElementById('shopping-item-form');
const shoppingItemInput = document.getElementById('shopping-item-input');
const shoppingItemParse = document.getElementById('shopping-item-parse');
const shoppingItemCancel = document.getElementById('shopping-item-cancel');
const syncStatus = document.getElementById('sync-status');
const syncOfflineNotice = document.getElementById('sync-offline-notice');
const appTitleTrigger = document.getElementById('app-title-trigger');
const appTitle = document.getElementById('app-title');
const globalSearchInput = document.getElementById('global-search-input');
const globalSearchMenu = document.getElementById('global-search-menu');
const mobileTopMenuButton = document.getElementById('mobile-top-menu-button');
const mobileTopMenu = document.getElementById('mobile-top-menu');
const mobileTitleMenu = document.getElementById('mobile-title-menu');
const mobileMenuTasks = document.getElementById('mobile-menu-tasks');
const mobileMenuScheduling = document.getElementById('mobile-menu-scheduling');
const mobileMenuNotices = document.getElementById('mobile-menu-notices');
const mobileMenuSettings = document.getElementById('mobile-menu-settings');
const mobileMenuProfile = document.getElementById('mobile-menu-profile');
const mobileMenuWorkspaces = document.getElementById('mobile-menu-workspaces');
const mobileMenuAuth = document.getElementById('mobile-menu-auth');
const mobileNav = document.getElementById('mobile-nav');
const mobileNavPrimary = document.getElementById('mobile-nav-primary');
const mobileNavProjects = document.getElementById('mobile-nav-projects');
const mobileNavShopping = document.getElementById('mobile-nav-shopping');
const mobileNavWorkflows = document.getElementById('mobile-nav-workflows');
const mobileNavButtons = Array.from(document.querySelectorAll('.mobile-nav-button[data-view]'));
const mobileNavAdd = document.getElementById('mobile-nav-add');
const mobileCreateSheet = document.getElementById('mobile-create-sheet');
const mobileCreateSheetBackdrop = document.getElementById('mobile-create-sheet-backdrop');
const mobileCreateSheetTitle = document.getElementById('mobile-create-sheet-title');
const mobileCreateSheetClose = document.getElementById('mobile-create-sheet-close');
const mobileCreateSheetActions = document.getElementById('mobile-create-sheet-actions');
const mobileCreateTask = document.getElementById('mobile-create-task');
const mobileCreateNotice = document.getElementById('mobile-create-notice');
const mobileCreateWorkflow = document.getElementById('mobile-create-workflow');
const mobileCreateShopping = document.getElementById('mobile-create-shopping');
const mobileTaskQuickAddForm = document.getElementById('mobile-task-quick-add-form');
const mobileTaskQuickAddInput = document.getElementById('mobile-task-quick-add-input');
const mobileTaskQuickAddCancel = document.getElementById('mobile-task-quick-add-cancel');
const mobileSearchModal = document.getElementById('mobile-search-modal');
const mobileSearchBackdrop = document.getElementById('mobile-search-backdrop');
const mobileSearchClose = document.getElementById('mobile-search-close');
const mobileSearchInput = document.getElementById('mobile-search-input');
const mobileSearchResults = document.getElementById('mobile-search-results');
const mobileCalendarsModal = document.getElementById('mobile-calendars-modal');
const mobileCalendarsBackdrop = document.getElementById('mobile-calendars-backdrop');
const mobileCalendarsClose = document.getElementById('mobile-calendars-close');
const mobileCalendarList = document.getElementById('mobile-calendar-list');
const mobileCalendarAdd = document.getElementById('mobile-calendar-add');
const mobileCalendarLayerEvent = document.getElementById('mobile-calendar-layer-event');
const mobileCalendarLayerTimeBlock = document.getElementById('mobile-calendar-layer-time-block');
const mobileCalendarLayerDayOff = document.getElementById('mobile-calendar-layer-day-off');
const mobileCalendarLayerTasks = document.getElementById('mobile-calendar-layer-tasks');
const mobileCalendarLayerHolidays = document.getElementById('mobile-calendar-layer-holidays');
const newWorkspaceBtn = document.getElementById('new-workspace-btn');
const moduleNavTodo = document.getElementById('module-nav-todo');
const moduleNavScheduling = document.getElementById('module-nav-scheduling');
const noticeBell = document.getElementById('notice-bell');
const noticeBellMenu = document.getElementById('notice-bell-menu');
const taskModal = document.getElementById('task-modal');
const taskModalForm = document.getElementById('task-modal-form');
const modalTitle = document.getElementById('modal-title');
const modalPriority = document.getElementById('modal-priority');
const modalStatus = document.getElementById('modal-status');
const modalStart = document.getElementById('modal-start');
const modalDue = document.getElementById('modal-due');
const modalDesc = document.getElementById('modal-desc');
const modalCancel = document.getElementById('modal-cancel');
const modalType = document.getElementById('modal-type');
const modalTags = document.getElementById('modal-tags');
const modalAssignee = document.getElementById('modal-assignee');
const modalAssigneeLabelRow = document.getElementById('modal-assignee-label-row');
const modalAssigneeLabel = document.getElementById('modal-assignee-label');
const modalRecurringButton = document.getElementById('modal-recurring-button');
const modalRecurringSummary = document.getElementById('modal-recurring-summary');
const modalReminder = document.getElementById('modal-reminder');
const scheduleEventModal = document.getElementById('schedule-event-modal');
const scheduleEventModalTitle = document.getElementById('schedule-event-modal-title');
const scheduleEventForm = document.getElementById('schedule-event-form');
const scheduleEventTitle = document.getElementById('schedule-event-title');
const scheduleEventCalendar = document.getElementById('schedule-event-calendar');
const scheduleEventKind = document.getElementById('schedule-event-kind');
const scheduleEventType = document.getElementById('schedule-event-type');
const scheduleEventColorOverride = document.getElementById('schedule-event-color-override');
const scheduleEventColorPresets = document.getElementById('schedule-event-color-presets');
const scheduleEventColor = document.getElementById('schedule-event-color');
const scheduleEventAllDay = document.getElementById('schedule-event-all-day');
const scheduleEventRepeatInterval = document.getElementById('schedule-event-repeat-interval');
const scheduleEventRepeatUnit = document.getElementById('schedule-event-repeat-unit');
const scheduleEventStart = document.getElementById('schedule-event-start');
const scheduleEventEnd = document.getElementById('schedule-event-end');
const scheduleEventReminder = document.getElementById('schedule-event-reminder');
const scheduleEventAttendees = document.getElementById('schedule-event-attendees');
const scheduleEventNotes = document.getElementById('schedule-event-notes');
const scheduleEventDescriptionEditor = document.getElementById('schedule-event-description-editor');
const scheduleEventDescription = document.getElementById('schedule-event-description');
const scheduleEventDescriptionButtons = scheduleEventDescriptionEditor
  ? Array.from(scheduleEventDescriptionEditor.querySelectorAll('.schedule-rich-toolbar .notes-btn'))
  : [];
const scheduleEventDelete = document.getElementById('schedule-event-delete');
const scheduleEventPrint = document.getElementById('schedule-event-print');
const scheduleEventEdit = document.getElementById('schedule-event-edit');
const scheduleEventSave = document.getElementById('schedule-event-save');
const scheduleEventCancel = document.getElementById('schedule-event-cancel');
const templateModal = document.getElementById('template-modal');
const templateModalForm = document.getElementById('template-modal-form');
const templateName = document.getElementById('template-name');
const templateSteps = document.getElementById('template-steps');
const templateLeadDays = document.getElementById('template-lead-days');
const templateNextDate = document.getElementById('template-next-date');
const templateRepeatInterval = document.getElementById('template-repeat-interval');
const templateRepeatUnit = document.getElementById('template-repeat-unit');
const templateCancel = document.getElementById('template-cancel');
const templateProject = document.getElementById('template-project');
const workflowModal = document.getElementById('workflow-modal');
const workflowModalTitle = document.getElementById('workflow-modal-title');
const workflowModalForm = document.getElementById('workflow-modal-form');
const workflowNameInput = document.getElementById('workflow-name');
const workflowDescriptionInput = document.getElementById('workflow-description');
const workflowCancel = document.getElementById('workflow-cancel');
const workflowInstanceModal = document.getElementById('workflow-instance-modal');
const workflowInstanceForm = document.getElementById('workflow-instance-form');
const workflowInstanceVariant = document.getElementById('workflow-instance-variant');
const workflowInstanceTitleInput = document.getElementById('workflow-instance-title');
const workflowInstanceNotesInput = document.getElementById('workflow-instance-notes');
const workflowInstanceCancel = document.getElementById('workflow-instance-cancel');
const workflowApplicabilityModal = document.getElementById('workflow-applicability-modal');
const workflowApplicabilityForm = document.getElementById('workflow-applicability-form');
const workflowApplicabilityTitle = document.getElementById('workflow-applicability-title');
const workflowApplicabilitySubtitle = document.getElementById('workflow-applicability-subtitle');
const workflowApplicabilityList = document.getElementById('workflow-applicability-list');
const workflowApplicabilityCancel = document.getElementById('workflow-applicability-cancel');
const accountButton = document.getElementById('account-button');
const accountMenu = document.getElementById('account-menu');
const accountAvatar = document.getElementById('account-avatar');
const accountListAvatar = document.getElementById('account-list-avatar');
const accountListName = document.getElementById('account-list-name');
const accountProfileAvatar = document.getElementById('account-profile-avatar');
const accountProfileName = document.getElementById('account-profile-name');
const accountProfileEmail = document.getElementById('account-profile-email');
const accountLogout = document.getElementById('account-logout');
const accountAdmin = document.getElementById('account-admin');
const authModal = document.getElementById('auth-modal');
const authModalTitle = document.getElementById('auth-modal-title');
const authStatus = document.getElementById('auth-status');
const authLoginForm = document.getElementById('auth-login-form');
const authLoginEmail = document.getElementById('auth-login-email');
const authLoginPassword = document.getElementById('auth-login-password');
const authInviteForm = document.getElementById('auth-invite-form');
const authInviteToken = document.getElementById('auth-invite-token');
const authInviteEmail = document.getElementById('auth-invite-email');
const authInviteName = document.getElementById('auth-invite-name');
const authInvitePassword = document.getElementById('auth-invite-password');
const authCancel = document.getElementById('auth-cancel');
const authCancelInvite = document.getElementById('auth-cancel-invite');
const authOpenInvite = document.getElementById('auth-open-invite');
const authBackLogin = document.getElementById('auth-back-login');
const settingsOpen = document.getElementById('settings-open');
const profileOpen = document.getElementById('profile-open');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsOpenTemplates = document.getElementById('settings-open-templates');
const settingsOpenDataTransfer = document.getElementById('settings-open-data-transfer');
const settingsOpenAuditLog = document.getElementById('settings-open-audit-log');
const settingsOpenAutomation = document.getElementById('settings-open-automation');
const settingsOpenHelp = document.getElementById('settings-open-help');
const settingsTabButtons = Array.from(document.querySelectorAll('.settings-tab-button[data-settings-tab]'));
const settingsTabPanels = Array.from(document.querySelectorAll('.settings-tab-panel[data-settings-panel]'));
const templateManagerModal = document.getElementById('template-manager-modal');
const templateManagerClose = document.getElementById('template-manager-close');
const dataTransferBack = document.getElementById('data-transfer-back');
const auditLogBack = document.getElementById('audit-log-back');
const automationBack = document.getElementById('automation-back');
const helpBack = document.getElementById('help-back');
const helpApiBase = document.getElementById('help-api-base');
const helpWorkspaceId = document.getElementById('help-workspace-id');
const helpTaskCreateExample = document.getElementById('help-task-create-example');
const helpTaskUpdateExample = document.getElementById('help-task-update-example');
const helpSyncPullExample = document.getElementById('help-sync-pull-example');
const adminPageBack = document.getElementById('admin-page-back');
const adminInviteEmail = document.getElementById('admin-invite-email');
const adminInviteRole = document.getElementById('admin-invite-role');
const adminInviteSend = document.getElementById('admin-invite-send');
const adminInviteTokenWrap = document.getElementById('admin-invite-token-wrap');
const adminInviteToken = document.getElementById('admin-invite-token');
const adminInviteTokenCopy = document.getElementById('admin-invite-token-copy');
const adminInviteStatus = document.getElementById('admin-invite-status');
const adminInvitesList = document.getElementById('admin-invites-list');
const adminUsersStatus = document.getElementById('admin-users-status');
const adminUsersList = document.getElementById('admin-users-list');
const adminUsersRefresh = document.getElementById('admin-users-refresh');
const adminUserSelect = document.getElementById('admin-user-select');
const adminUserName = document.getElementById('admin-user-name');
const adminUserEmail = document.getElementById('admin-user-email');
const adminUserRole = document.getElementById('admin-user-role');
const adminUserArchived = document.getElementById('admin-user-archived');
const adminUserSettings = document.getElementById('admin-user-settings');
const adminUserSave = document.getElementById('admin-user-save');
const adminUserPassword = document.getElementById('admin-user-password');
const adminUserPasswordReset = document.getElementById('admin-user-password-reset');
const adminUserExport = document.getElementById('admin-user-export');
const adminUserDelete = document.getElementById('admin-user-delete');
const adminOwnershipTransfer = document.getElementById('admin-ownership-transfer');
const profilePageBack = document.getElementById('profile-page-back');
const profilePageSave = document.getElementById('profile-page-save');
const profilePageAvatar = document.getElementById('profile-page-avatar');
const profilePageSummaryName = document.getElementById('profile-page-summary-name');
const profilePageSummaryEmail = document.getElementById('profile-page-summary-email');
const profilePageName = document.getElementById('profile-page-name');
const profilePageEmail = document.getElementById('profile-page-email');
const profilePageWorkspace = document.getElementById('profile-page-workspace');
const profilePageWorkspaceType = document.getElementById('profile-page-workspace-type');
const dataExportFormat = document.getElementById('data-export-format');
const dataExportIncludeAudit = document.getElementById('data-export-include-audit');
const dataExportDownload = document.getElementById('data-export-download');
const dataImportFile = document.getElementById('data-import-file');
const dataImportReplace = document.getElementById('data-import-replace');
const dataImportApply = document.getElementById('data-import-apply');
const auditLogFilter = document.getElementById('audit-log-filter');
const auditLogRefresh = document.getElementById('audit-log-refresh');
const auditLogCopy = document.getElementById('audit-log-copy');
const auditLogClear = document.getElementById('audit-log-clear');
const auditLogOutput = document.getElementById('audit-log-output');
const automationInput = document.getElementById('automation-input');
const automationRun = document.getElementById('automation-run');
const automationClear = document.getElementById('automation-clear');
const automationOutput = document.getElementById('automation-output');
const automationCopyGuide = document.getElementById('automation-copy-guide');
const taskTypesOpen = document.getElementById('task-types-open');
const taskTypesModal = document.getElementById('task-types-modal');
const taskTypesClose = document.getElementById('task-types-close');
const scheduleEventTypesOpen = document.getElementById('schedule-event-types-open');
const scheduleEventTypesModal = document.getElementById('schedule-event-types-modal');
const scheduleEventTypesClose = document.getElementById('schedule-event-types-close');
const scheduleEventTypeListEl = document.getElementById('schedule-event-type-list');
const scheduleEventTypeNameInput = document.getElementById('schedule-event-type-name');
const scheduleEventTypeColorInput = document.getElementById('schedule-event-type-color');
const scheduleEventTypeTemplateInput = document.getElementById('schedule-event-type-template');
const scheduleEventTypeAddBtn = document.getElementById('schedule-event-type-add');
const storeRulesOpen = document.getElementById('store-rules-open');
const storeRulesModal = document.getElementById('store-rules-modal');
const storeRulesClose = document.getElementById('store-rules-close');
const recurrenceModal = document.getElementById('recurrence-modal');
const recurrenceForm = document.getElementById('recurrence-form');
const recurrenceInterval = document.getElementById('recurrence-interval');
const recurrenceUnit = document.getElementById('recurrence-unit');
const recurrenceClear = document.getElementById('recurrence-clear');
const recurrenceCancel = document.getElementById('recurrence-cancel');
const noticeModal = document.getElementById('notice-modal');
const noticeModalTitle = noticeModal?.querySelector('h2') ?? null;
const noticeForm = document.getElementById('notice-form');
const noticeReadonly = document.getElementById('notice-readonly');
const noticeReadonlyTitle = document.getElementById('notice-readonly-title');
const noticeReadonlyType = document.getElementById('notice-readonly-type');
const noticeReadonlyDatetime = document.getElementById('notice-readonly-datetime');
const noticeReadonlyRepeat = document.getElementById('notice-readonly-repeat');
const noticeFormFields = document.getElementById('notice-form-fields');
const noticeTitle = document.getElementById('notice-title');
const noticeType = document.getElementById('notice-type');
const noticeTypeModal = document.getElementById('notice-type-modal');
const noticeTypeForm = document.getElementById('notice-type-form');
const noticeTypeNameInput = document.getElementById('notice-type-name');
const noticeTypeCancel = document.getElementById('notice-type-cancel');
const noticeDate = document.getElementById('notice-date');
const noticeTime = document.getElementById('notice-time');
const noticeRepeatPreset = document.getElementById('notice-repeat-preset');
const noticeSaveBtn = document.getElementById('notice-save');
const noticeDismissBtn = document.getElementById('notice-dismiss');
const noticeCancel = document.getElementById('notice-cancel');
const noticeRecurrenceModal = document.getElementById('notice-recurrence-modal');
const noticeRecurrenceForm = document.getElementById('notice-recurrence-form');
const noticeCustomInterval = document.getElementById('notice-custom-interval');
const noticeCustomUnit = document.getElementById('notice-custom-unit');
const noticeCustomWeekdaysRow = document.getElementById('notice-custom-weekdays-row');
const noticeCustomWeekdays = document.getElementById('notice-custom-weekdays');
const noticeCustomEndDate = document.getElementById('notice-custom-end-date');
const noticeCustomEndCount = document.getElementById('notice-custom-end-count');
const noticeRecurrenceCancel = document.getElementById('notice-recurrence-cancel');
const checkinModal = document.getElementById('checkin-modal');
const checkinTaskTitle = document.getElementById('checkin-task-title');
const checkinYes = document.getElementById('checkin-yes');
const checkinNo = document.getElementById('checkin-no');
const checkinInProgress = document.getElementById('checkin-inprogress');
const checkinDismiss = document.getElementById('checkin-dismiss');
const checkinProgressModal = document.getElementById('checkin-progress-modal');
const checkinProgressTitle = document.getElementById('checkin-progress-title');
const checkinProgressYes = document.getElementById('checkin-progress-yes');
const checkinProgressNo = document.getElementById('checkin-progress-no');
const checkinProgressBack = document.getElementById('checkin-progress-back');
const checkinNoModal = document.getElementById('checkin-no-modal');
const checkinNoTitle = document.getElementById('checkin-no-title');
const checkinNoExtend = document.getElementById('checkin-no-extend');
const checkinNoFirst = document.getElementById('checkin-no-first');
const checkinNoReschedule = document.getElementById('checkin-no-reschedule');
const checkinNoDismiss = document.getElementById('checkin-no-dismiss');
const checkinNoBack = document.getElementById('checkin-no-back');
const checkinRescheduleModal = document.getElementById('checkin-reschedule-modal');
const checkinRescheduleTitle = document.getElementById('checkin-reschedule-title');
const checkinCustomDue = document.getElementById('checkin-custom-due');
const checkinRescheduleApply = document.getElementById('checkin-reschedule-apply');
const checkinRescheduleCancel = document.getElementById('checkin-reschedule-cancel');
const checkinRescheduleBack = document.getElementById('checkin-reschedule-back');
const checkinDefaultMinutesInput = document.getElementById('checkin-default-minutes');
const taskUiQuickAddInput = document.getElementById('task-ui-quick-add');
const taskUiCompletedVisibilitySelect = document.getElementById('task-ui-completed-visibility');
const taskUiFutureDaysInput = document.getElementById('task-ui-future-days');
const taskUiFilterSelect = document.getElementById('task-ui-filter');
const taskUiSortSelect = document.getElementById('task-ui-sort');
const taskUiGroupSelect = document.getElementById('task-ui-group');
const taskUiViewSelect = document.getElementById('task-ui-view');
const taskUiHolidayList = document.getElementById('task-ui-holiday-list');
const schedulingUiWeekModeSelect = document.getElementById('scheduling-ui-week-mode');
const schedulingUiTimeZoneInput = document.getElementById('scheduling-ui-time-zone');
const schedulingUiDefaultDurationInput = document.getElementById('scheduling-ui-default-duration');
const taskEditor = document.getElementById('task-editor');
const taskEditorBody = document.getElementById('task-editor-body');
const taskEditorScrollbar = document.getElementById('task-editor-scrollbar');
const taskEditorScrollThumb = document.getElementById('task-editor-scroll-thumb');
const taskEditorForm = document.getElementById('task-editor-form');
const editorTitle = document.getElementById('editor-title');
const editorType = document.getElementById('editor-type');
const editorTags = document.getElementById('editor-tags');
const editorPriority = document.getElementById('editor-priority');
const editorRecurringButton = document.getElementById('editor-recurring-button');
const editorRecurringSummary = document.getElementById('editor-recurring-summary');
const editorReminder = document.getElementById('editor-reminder');
const editorStatus = document.getElementById('editor-status');
const editorFollowupSection = document.getElementById('editor-followup-section');
const editorFollowup = document.getElementById('editor-followup');
const editorFollowupNow = document.getElementById('editor-followup-now');
const editorFollowupSnooze = document.getElementById('editor-followup-snooze');
const editorFollowupClear = document.getElementById('editor-followup-clear');
const editorNotesContainer = document.getElementById('editor-notes');
const notesEditorWrapper = document.getElementById('notes-editor');
const notesModeButtons = notesEditorWrapper ? Array.from(notesEditorWrapper.querySelectorAll('.notes-mode')) : [];
const notesFormatButtons = notesEditorWrapper ? Array.from(notesEditorWrapper.querySelectorAll('.notes-toolbar-left .notes-btn')) : [];
const editorStart = document.getElementById('editor-start');
const editorDue = document.getElementById('editor-due');
const editorDesc = document.getElementById('editor-desc');
const editorSubtaskList = document.getElementById('editor-subtask-list');
const editorSubtaskCount = document.getElementById('editor-subtask-count');
const editorDependencyList = document.getElementById('editor-dependency-list');
const editorDependencyCount = document.getElementById('editor-dependency-count');
const editorDependencySelect = document.getElementById('editor-dependency-select');
const editorAddDependencyBtn = document.getElementById('editor-add-dependency');
const editorCancel = document.getElementById('editor-cancel');
const editorDelete = document.getElementById('editor-delete');
const editorClose = document.getElementById('editor-close');
const editorProject = document.getElementById('editor-project');
const editorAssignee = document.getElementById('editor-assignee');
const editorAssigneeLabelRow = document.getElementById('editor-assignee-label-row');
const editorAssigneeLabel = document.getElementById('editor-assignee-label');
const editorParent = document.getElementById('editor-parent');
const templatePrompt = document.getElementById('template-prompt');
const templatePromptTitle = document.getElementById('template-prompt-title');
const templatePromptText = document.getElementById('template-prompt-text');
const templatePromptStart = document.getElementById('template-prompt-start');
const templatePromptDefer = document.getElementById('template-prompt-defer');
const templatePromptDismiss = document.getElementById('template-prompt-dismiss');
const bulkEditModal = document.getElementById('bulk-edit-modal');
const bulkEditForm = document.getElementById('bulk-edit-form');
const bulkEditCount = document.getElementById('bulk-edit-count');
const bulkEditApplyStatus = document.getElementById('bulk-edit-apply-status');
const bulkEditStatus = document.getElementById('bulk-edit-status');
const bulkEditApplyPriority = document.getElementById('bulk-edit-apply-priority');
const bulkEditPriority = document.getElementById('bulk-edit-priority');
const bulkEditApplyProject = document.getElementById('bulk-edit-apply-project');
const bulkEditProject = document.getElementById('bulk-edit-project');
const bulkEditApplyType = document.getElementById('bulk-edit-apply-type');
const bulkEditType = document.getElementById('bulk-edit-type');
const bulkEditApplyStart = document.getElementById('bulk-edit-apply-start');
const bulkEditStart = document.getElementById('bulk-edit-start');
const bulkEditApplyDue = document.getElementById('bulk-edit-apply-due');
const bulkEditDue = document.getElementById('bulk-edit-due');
const bulkEditApplyReminder = document.getElementById('bulk-edit-apply-reminder');
const bulkEditReminder = document.getElementById('bulk-edit-reminder');
const bulkEditCancel = document.getElementById('bulk-edit-cancel');
const groupRenameModal = document.getElementById('group-rename-modal');
const groupRenameForm = document.getElementById('group-rename-form');
const groupRenameInput = document.getElementById('group-rename-input');
const groupRenameCancel = document.getElementById('group-rename-cancel');
const sectionSettingsModal = document.getElementById('section-settings-modal');
const sectionSettingsTitle = document.getElementById('section-settings-title');
const sectionSettingsForm = document.getElementById('section-settings-form');
const sectionSettingsCompleted = document.getElementById('section-settings-completed');
const sectionSettingsFutureDays = document.getElementById('section-settings-future-days');
const sectionSettingsDefaults = document.getElementById('section-settings-defaults');
const sectionSettingsCancel = document.getElementById('section-settings-cancel');
let openMenu = null;
let authModalMode = 'login';
let renameGroupTarget = null;
let sectionSettingsTarget = null;
let editingTemplateId = null;
let editingWorkflowId = null;
let templateEditorReturnTo = 'settings';
let activeTaskId = null;
let templatePromptTaskId = null;
let taskModalDefaults = {};
let draggingTaskId = null;
let draggingTaskEl = null;
let draggingTaskOrigin = null;
let draggingColumnKey = null;
let draggingColumnEl = null;
let draggingSectionId = null;
let draggingSectionEl = null;
let draggingWorkflowEntryMeta = null;
let draggingWorkflowEntryEl = null;
let draggingWorkflowPhaseMeta = null;
let draggingWorkflowPhaseEl = null;
let draggingShoppingInboxItemId = null;
let sectionOrderDirty = false;
let columnOrderDirty = false;
let suppressTaskClick = false;
let recurrenceContext = 'modal';
let modalRecurrence = { interval: null, unit: 'month' };
let editorRecurrence = { interval: null, unit: 'month' };
let syncInFlight = false;
let syncFailureCount = 0;
let syncCooldownUntil = 0;
let syncErrorCount = 0;
let syncLastSuccessAt = null;
let lastSyncAttentionMutationId = null;
let taskEditorSwapTimer = null;
let activeNoticeId = null;
let activeScheduleEventId = null;
let scheduleEventModalMode = 'create';
let scheduleEventClipboard = null;
let noticeModalMode = 'create';
let noticeTypePreviousKey = 'general';
let shoppingStorePreviousSelection = '';
let noticeRecurrenceDraft = null;
let activeCheckinTaskId = null;
let checkinProgressTaskId = null;
let checkinRescheduleContext = null;
const checkinSnoozes = new Map();
let notesEditorView = null;
let notesEditorStateCtor = null;
let notesMarkdownParser = null;
let notesMarkdownSerializer = null;
let activeWorkflowApplicabilityInstanceId = null;
let notesSchema = null;
let notesEditorPlugins = [];
let notesMode = notesEditorWrapper?.classList.contains('is-markdown') ? 'markdown' : 'rich';
let notesEditorInitPromise = null;
let pendingNotesContent = '';
let notesDisplayMode = true;
let notesPointerDown = false;
let notesPointerMoved = false;
let notesPointerStart = { x: 0, y: 0 };
let taskEditorAutosaveTimer = null;
let taskEditorAutosaveInFlight = false;
let taskEditorAutosaveQueued = false;
let isPopulatingTaskEditor = false;
let editorMouseDown = false;
let suppressEditorCloseOnce = false;
let taskEditorScrollbarDragging = false;
let taskEditorScrollbarDragStart = 0;
let taskEditorScrollbarScrollStart = 0;
let undoToastTimer = null;
let undoToastEl = null;
let taskSearchDebounceTimer = null;
let taskSearchRequestSeq = 0;
let taskSearchResultIds = null;
let taskSearchResultKey = '';
let taskSearchInFlightKey = '';
let adminInvitesAutoRefreshTimer = null;
let adminUsersAutoRefreshTimer = null;
let userSettingsSaveTimer = null;

const SYNC_POLL_INTERVAL_MS = 5000;
const SYNC_BACKOFF_STEPS_MS = [30000, 60000, 120000, 300000];
const ADMIN_INVITES_AUTO_REFRESH_MS = 15000;
const ADMIN_USERS_AUTO_REFRESH_MS = 20000;
const USER_SETTINGS_SAVE_DEBOUNCE_MS = 350;
const AUDIT_LOG_MAX_ENTRIES = 2000;
const AUDIT_LOG_ALLOWED_CATEGORIES = new Set(['crud', 'notification', 'export', 'import', 'error']);
const NAVIGABLE_VIEWS = new Set([
  'tasks',
  'scheduling',
  'projects',
  'shopping',
  'notices',
  'workflows',
  'help',
  'admin',
  'profile',
  'data-transfer',
  'audit-log',
  'automation',
  'workspaces-manage',
  'workspaces-archived'
]);
const NAVIGATION_STATE_VERSION = 1;

let auditLogSanitized = false;
let navigationHistoryReady = false;
let navigationHistoryApplying = false;
let navigationHistoryLastSignature = '';

document.addEventListener('click', () => {
  if (openMenu) {
    openMenu.classList.add('hidden');
    if (openMenu === mobileTitleMenu) {
      appTitleTrigger?.setAttribute('aria-expanded', 'false');
    }
    openMenu = null;
    document.querySelectorAll('.task-item.menu-open').forEach(item => item.classList.remove('menu-open'));
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (mobileCreateSheet && !mobileCreateSheet.classList.contains('hidden')) {
    closeMobileCreateSheet();
    return;
  }
  const hasSelection = getSelectedTaskIds().length > 0;
  const modalOpen = Boolean(document.querySelector('.modal:not(.hidden)'));
  if (hasSelection && !modalOpen) {
    clearSelectedTasks();
  }
});

document.addEventListener('click', (event) => {
  if (!taskEditor || !taskEditor.classList.contains('is-open')) return;
  if (suppressEditorCloseOnce) {
    suppressEditorCloseOnce = false;
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#task-editor')) return;
  if (target.closest('.modal')) return;
  if (target.closest('.task-item') || target.closest('.kanban-card')) return;
  closeTaskEditor();
});

taskEditor?.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  editorMouseDown = true;
});

document.addEventListener('mouseup', (event) => {
  if (!editorMouseDown) return;
  editorMouseDown = false;
  const target = event.target;
  if (!(target instanceof Element)) {
    suppressEditorCloseOnce = true;
    return;
  }
  if (!target.closest('#task-editor')) {
    suppressEditorCloseOnce = true;
  }
});

taskEditorBody?.addEventListener('scroll', () => {
  updateTaskEditorScrollbar();
});

taskEditorScrollThumb?.addEventListener('mousedown', (event) => {
  event.preventDefault();
  taskEditorScrollbarDragging = true;
  taskEditorScrollbarDragStart = event.clientY;
  taskEditorScrollbarScrollStart = taskEditorBody?.scrollTop ?? 0;
});

taskEditorScrollbar?.addEventListener('click', (event) => {
  if (!taskEditorBody || !taskEditorScrollThumb) return;
  if (event.target === taskEditorScrollThumb) return;
  const rect = taskEditorScrollbar.getBoundingClientRect();
  const clickY = event.clientY - rect.top;
  const thumbHeight = taskEditorScrollThumb.offsetHeight;
  const trackHeight = taskEditorBody.clientHeight;
  const maxScroll = taskEditorBody.scrollHeight - trackHeight;
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const nextThumbTop = Math.min(maxThumbTop, Math.max(0, clickY - thumbHeight / 2));
  const ratio = maxThumbTop ? nextThumbTop / maxThumbTop : 0;
  taskEditorBody.scrollTop = ratio * maxScroll;
});

document.addEventListener('mousemove', (event) => {
  if (!taskEditorScrollbarDragging || !taskEditorBody || !taskEditorScrollThumb) return;
  const trackHeight = taskEditorBody.clientHeight;
  const thumbHeight = taskEditorScrollThumb.offsetHeight;
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScroll = taskEditorBody.scrollHeight - trackHeight;
  const delta = event.clientY - taskEditorScrollbarDragStart;
  const ratio = maxThumbTop ? delta / maxThumbTop : 0;
  taskEditorBody.scrollTop = taskEditorScrollbarScrollStart + ratio * maxScroll;
});

document.addEventListener('mouseup', () => {
  taskEditorScrollbarDragging = false;
});

const taskEditorResizeObserver = taskEditorBody ? new ResizeObserver(() => {
  updateTaskEditorScrollbar();
}) : null;

taskEditorResizeObserver?.observe(taskEditorBody);

workspaceMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== workspaceMenu && openMenu !== accountMenu) {
    openMenu.classList.add('hidden');
  }
  if (workspaceMenu.classList.contains('hidden')) {
    workspaceMenu.classList.remove('hidden');
    openMenu = workspaceMenu;
  } else {
    workspaceMenu.classList.add('hidden');
    openMenu = null;
  }
});

workspaceDropdownButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== workspaceListEl && openMenu !== accountMenu) {
    openMenu.classList.add('hidden');
  }
  if (workspaceListEl.classList.contains('hidden')) {
    workspaceListEl.classList.remove('hidden');
    openMenu = workspaceListEl;
  } else {
    workspaceListEl.classList.add('hidden');
    openMenu = null;
  }
});

workspaceMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

accountButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!accountMenu) return;
  if (openMenu && openMenu !== accountMenu) {
    openMenu.classList.add('hidden');
  }
  if (accountMenu.classList.contains('hidden')) {
    accountMenu.classList.remove('hidden');
    openMenu = accountMenu;
  } else {
    accountMenu.classList.add('hidden');
    openMenu = null;
  }
});

accountMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

noticeBell?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!noticeBellMenu) return;
  if (openMenu && openMenu !== noticeBellMenu) {
    openMenu.classList.add('hidden');
  }
  if (noticeBellMenu.classList.contains('hidden')) {
    renderNoticeBellMenu();
    noticeBellMenu.classList.remove('hidden');
    openMenu = noticeBellMenu;
  } else {
    noticeBellMenu.classList.add('hidden');
    openMenu = null;
  }
});

noticeBellMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

manageWorkspacesBtn?.addEventListener('click', (event) => {
  event.stopPropagation();
  setActiveView('workspaces-manage');
  workspaceMenu?.classList.add('hidden');
  workspaceListEl?.classList.add('hidden');
  openMenu = null;
  render();
});

archivedWorkspacesBtn?.addEventListener('click', (event) => {
  event.stopPropagation();
  setActiveView('workspaces-archived');
  workspaceMenu?.classList.add('hidden');
  workspaceListEl?.classList.add('hidden');
  openMenu = null;
  render();
});

taskCreatePrimary?.addEventListener('click', () => {
  taskCreateMenu?.classList.add('hidden');
  if (openMenu === taskCreateMenu) openMenu = null;
  setActiveView('tasks');
  clearActiveWorkflowChecklistInstanceId();
  render();
  openTaskModal();
});

tasksMobileAddBtn?.addEventListener('click', () => {
  taskCreateMenu?.classList.add('hidden');
  if (openMenu === taskCreateMenu) openMenu = null;
  setActiveView('tasks');
  clearActiveWorkflowChecklistInstanceId();
  render();
  openTaskModal();
});

taskCreateMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!taskCreateMenu) return;
  if (openMenu && openMenu !== taskCreateMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskCreateMenu.classList.contains('hidden')) {
    taskCreateMenu.classList.remove('hidden');
    openMenu = taskCreateMenu;
  } else {
    taskCreateMenu.classList.add('hidden');
    if (openMenu === taskCreateMenu) openMenu = null;
  }
});

taskCreateMenu?.addEventListener('click', async (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.create;
  if (!action) return;
  taskCreateMenu.classList.add('hidden');
  if (openMenu === taskCreateMenu) openMenu = null;
  setActiveView('tasks');
  clearActiveWorkflowChecklistInstanceId();
  if (action === 'task') {
    render();
    openTaskModal();
    return;
  }
  if (action === 'section') {
    const name = prompt('Section name');
    if (!name) return;
    setTaskGroupMode('section');
    createSectionRecord(name);
    render();
  }
});

globalSearchInput?.addEventListener('click', (event) => {
  event.stopPropagation();
});

globalSearchInput?.addEventListener('focus', () => {
  renderGlobalSearch();
});

globalSearchInput?.addEventListener('input', () => {
  setGlobalSearchQuery(globalSearchInput.value);
  renderGlobalSearch();
});

globalSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeGlobalSearchMenu();
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const query = getGlobalSearchQuery();
  if (!query) return;
  const results = getGlobalSearchResults(query);
  const primary = getGlobalSearchPrimaryResult(results, getGlobalSearchScope());
  if (!primary) return;
  closeGlobalSearchMenu();
  handleGlobalSearchResultSelect(primary.kind, primary.id);
});

globalSearchMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target instanceof Element ? event.target.closest('button') : null;
  if (!(target instanceof HTMLButtonElement)) return;
  const scope = target.dataset.scope;
  if (scope) {
    setGlobalSearchScope(scope);
    renderGlobalSearch();
    return;
  }
  const action = target.dataset.action;
  if (action === 'toggle-task-results') {
    setGlobalSearchExpandTasks(!getGlobalSearchExpandTasks());
    renderGlobalSearch();
    return;
  }
  if (action === 'view-all-results') {
    const query = getGlobalSearchQuery();
    setActiveView('tasks');
    clearActiveWorkflowChecklistInstanceId();
    setActiveTaskFilter('all');
    state.ui = state.ui ?? {};
    state.ui.taskSearchText = query;
    scheduleTaskSearchRefresh(true);
    closeGlobalSearchMenu();
    render();
    return;
  }
  const kind = target.dataset.kind;
  const id = target.dataset.id;
  if (!kind || !id) return;
  closeGlobalSearchMenu();
  handleGlobalSearchResultSelect(kind, id);
});

taskFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (isWorkflowChecklistViewActive()) {
    return;
  }
  if (openMenu && openMenu !== taskFilterMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskFilterMenu.classList.contains('hidden')) {
    taskFilterMenu.classList.remove('hidden');
    openMenu = taskFilterMenu;
  } else {
    taskFilterMenu.classList.add('hidden');
    openMenu = null;
  }
});

taskFilterMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const filter = target.dataset.filter;
  if (!filter) return;
  setActiveTaskFilter(filter);
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  taskFilterMenu.classList.add('hidden');
  openMenu = null;
  scheduleTaskSearchRefresh(true);
  render();
});

taskFilterSearchInput?.addEventListener('click', (event) => {
  event.stopPropagation();
});

taskFilterSearchInput?.addEventListener('input', () => {
  state.ui = state.ui ?? {};
  state.ui.taskSearchText = taskFilterSearchInput.value;
  scheduleTaskSearchRefresh();
  render();
});

taskFilterSearchInput?.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    taskFilterSearchInput.value = '';
    state.ui = state.ui ?? {};
    state.ui.taskSearchText = '';
    scheduleTaskSearchRefresh(true);
    render();
  }
});

taskFilterTagInput?.addEventListener('click', (event) => {
  event.stopPropagation();
});

taskFilterTagInput?.addEventListener('input', () => {
  state.ui = state.ui ?? {};
  state.ui.taskTagFilter = taskFilterTagInput.value;
  scheduleTaskSearchRefresh();
  render();
});

taskFilterTagInput?.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    taskFilterTagInput.value = '';
    state.ui = state.ui ?? {};
    state.ui.taskTagFilter = '';
    scheduleTaskSearchRefresh(true);
    render();
  }
});

taskAiButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!taskAiMenu) return;
  if (openMenu && openMenu !== taskAiMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskAiMenu.classList.contains('hidden')) {
    renderAiSuggestionsMenu(getFilteredTasks());
    taskAiMenu.classList.remove('hidden');
    openMenu = taskAiMenu;
  } else {
    taskAiMenu.classList.add('hidden');
    openMenu = null;
  }
});

taskAiMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

taskSortButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== taskSortMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskSortMenu.classList.contains('hidden')) {
    taskSortMenu.classList.remove('hidden');
    openMenu = taskSortMenu;
  } else {
    taskSortMenu.classList.add('hidden');
    openMenu = null;
  }
});

taskSortMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const sortKey = target.dataset.sort;
  if (!sortKey) return;
  setTaskSortKey(sortKey);
  taskSortMenu.classList.add('hidden');
  openMenu = null;
  render();
});

taskGroupButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== taskGroupMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskGroupMenu.classList.contains('hidden')) {
    taskGroupMenu.classList.remove('hidden');
    openMenu = taskGroupMenu;
  } else {
    taskGroupMenu.classList.add('hidden');
    openMenu = null;
  }
});

taskGroupMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const mode = target.dataset.group;
  if (!mode) return;
  setTaskGroupMode(mode);
  taskGroupMenu.classList.add('hidden');
  openMenu = null;
  render();
});

noticeFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== noticeFilterMenu) {
    openMenu.classList.add('hidden');
  }
  if (noticeFilterMenu.classList.contains('hidden')) {
    noticeFilterMenu.classList.remove('hidden');
    openMenu = noticeFilterMenu;
  } else {
    noticeFilterMenu.classList.add('hidden');
    openMenu = null;
  }
});

noticeFilterMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const filterKey = target.dataset.filter;
  if (!filterKey) return;
  setNoticeFilterKey(filterKey);
  noticeFilterMenu.classList.add('hidden');
  openMenu = null;
  render();
});

noticeSortButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== noticeSortMenu) {
    openMenu.classList.add('hidden');
  }
  if (noticeSortMenu.classList.contains('hidden')) {
    noticeSortMenu.classList.remove('hidden');
    openMenu = noticeSortMenu;
  } else {
    noticeSortMenu.classList.add('hidden');
    openMenu = null;
  }
});

noticeSortMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const sortKey = target.dataset.sort;
  if (!sortKey) return;
  setNoticeSortKey(sortKey);
  noticeSortMenu.classList.add('hidden');
  openMenu = null;
  render();
});

projectFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== projectFilterMenu) {
    openMenu.classList.add('hidden');
  }
  if (projectFilterMenu.classList.contains('hidden')) {
    projectFilterMenu.classList.remove('hidden');
    openMenu = projectFilterMenu;
  } else {
    projectFilterMenu.classList.add('hidden');
    openMenu = null;
  }
});

projectFilterMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const filterKey = target.dataset.filter;
  if (!filterKey) return;
  setProjectFilterKey(filterKey);
  projectFilterMenu.classList.add('hidden');
  openMenu = null;
  render();
});

shoppingFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== shoppingFilterMenu) {
    openMenu.classList.add('hidden');
  }
  if (shoppingFilterMenu.classList.contains('hidden')) {
    shoppingFilterMenu.classList.remove('hidden');
    openMenu = shoppingFilterMenu;
  } else {
    shoppingFilterMenu.classList.add('hidden');
    openMenu = null;
  }
});

shoppingFilterMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const filterKey = target.dataset.filter;
  if (!filterKey) return;
  setShoppingFilterKey(filterKey);
  shoppingFilterMenu.classList.add('hidden');
  openMenu = null;
  render();
});

taskViewSelect?.addEventListener('change', () => {
  setTaskView(taskViewSelect.value);
  render();
});

function openKanbanColumnModal() {
  if (!kanbanColumnModal) return;
  kanbanColumnName.value = '';
  kanbanColumnModal.classList.remove('hidden');
  kanbanColumnName.focus();
}

function closeKanbanColumnModal() {
  kanbanColumnModal?.classList.add('hidden');
}

taskColumnsButton?.addEventListener('click', () => {
  openKanbanColumnModal();
});

kanbanColumnCancel?.addEventListener('click', closeKanbanColumnModal);
kanbanColumnModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeKanbanColumnModal);

kanbanColumnForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = kanbanColumnName.value.trim();
  if (!label) return;
  await createStatusRecord(label);
  closeKanbanColumnModal();
  render();
});

modalRecurringButton?.addEventListener('click', () => {
  openRecurrenceModal('modal');
});

editorRecurringButton?.addEventListener('click', () => {
  openRecurrenceModal('editor');
});

recurrenceCancel?.addEventListener('click', closeRecurrenceModal);
recurrenceModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeRecurrenceModal);

recurrenceClear?.addEventListener('click', () => {
  setRecurrenceState(recurrenceContext, null, 'month');
  closeRecurrenceModal();
});

recurrenceForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const intervalValue = recurrenceInterval.value ? Number(recurrenceInterval.value) : null;
  const unitValue = recurrenceUnit.value;
  setRecurrenceState(recurrenceContext, intervalValue, unitValue);
  closeRecurrenceModal();
});

newNoticeSidebarBtn?.addEventListener('click', () => {
  setActiveView('tasks');
  openNoticeModal();
});
noticesOpenBtn?.addEventListener('click', () => {
  setActiveView('notices');
  render();
});
noticesAddBtn?.addEventListener('click', () => {
  setActiveView('notices');
  openNoticeModal();
});
projectsOpenBtn?.addEventListener('click', () => {
  setActiveView('projects');
  render();
});
shoppingOpenBtn?.addEventListener('click', () => {
  setShoppingPageMode('list');
  if (isMobileViewport()) {
    setMobileShoppingPanelMode('list');
  }
  setActiveView('shopping');
  render();
});
workflowsOpenBtn?.addEventListener('click', () => {
  setWorkflowViewMode('runs');
  if (isMobileViewport()) {
    setMobileWorkflowPanelMode('list');
  }
  setActiveView('workflows');
  render();
});
tasksOpenBtn?.addEventListener('click', () => {
  setActiveTaskFilter('all');
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});
moduleNavTodo?.addEventListener('click', () => {
  setActiveTaskFilter('all');
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});
newTaskListBtn?.addEventListener('click', async () => {
  if (!state.workspace) return;
  const nextName = prompt('List name');
  if (!nextName) return;
  const created = await createProjectRecord(nextName, { kind: PROJECT_KIND_LIST });
  if (!created?.id) return;
  setActiveTaskFilter(created.id);
  setTaskGroupMode('section');
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});

moduleNavScheduling?.addEventListener('click', () => {
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('scheduling');
  render();
});

schedulingSidebarOpen?.addEventListener('click', () => {
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('scheduling');
  render();
});

schedulingSidebarToday?.addEventListener('click', () => {
  const today = new Date();
  setSchedulingCalendarMonth(today);
  const rangeMode = getSchedulingCalendarRange();
  if (rangeMode === 'week') {
    setSchedulingCalendarWeekStart(today);
  } else if (rangeMode === 'day') {
    setSchedulingCalendarDay(today);
  }
  render();
});

schedulingSidebarAddEvent?.addEventListener('click', () => {
  openScheduleEventCreate('event');
});

schedulingSidebarAddTimeBlock?.addEventListener('click', () => {
  openScheduleEventCreate('time-block');
});

schedulingSidebarAddDayOff?.addEventListener('click', () => {
  openScheduleEventCreate('day-off');
});

schedulingCalendarAdd?.addEventListener('click', () => {
  openScheduleCalendarCreatePrompt();
});

schedulingCalendarList?.addEventListener('change', (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target || !target.matches('.schedule-calendar-toggle')) return;
  const calendarId = String(target.dataset.calendarId ?? '').trim();
  if (!calendarId) return;
  setSchedulingCalendarVisible(calendarId, target.checked);
  queueUserSettingsSave();
  render();
});

schedulingCalendarList?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const actionButton = target.closest('button[data-calendar-action]');
  if (!actionButton) return;
  const action = String(actionButton.getAttribute('data-calendar-action') ?? '');
  const calendarId = String(actionButton.getAttribute('data-calendar-id') ?? '');
  if (!calendarId) return;
  if (action === 'edit') {
    openScheduleCalendarEditPrompt(calendarId);
    return;
  }
  if (action === 'delete') {
    deleteScheduleCalendarFromUi(calendarId);
  }
});

schedulingLayerEvent?.addEventListener('change', () => {
  setSchedulingKindVisible('event', Boolean(schedulingLayerEvent.checked));
  queueUserSettingsSave();
  render();
});

schedulingLayerTimeBlock?.addEventListener('change', () => {
  setSchedulingKindVisible('time-block', Boolean(schedulingLayerTimeBlock.checked));
  queueUserSettingsSave();
  render();
});

schedulingLayerDayOff?.addEventListener('change', () => {
  setSchedulingKindVisible('day-off', Boolean(schedulingLayerDayOff.checked));
  queueUserSettingsSave();
  render();
});

schedulingLayerTasks?.addEventListener('change', () => {
  setSchedulingShowTasks(Boolean(schedulingLayerTasks.checked));
  queueUserSettingsSave();
  render();
});

schedulingLayerHolidays?.addEventListener('change', () => {
  setCalendarIncludeHolidays(Boolean(schedulingLayerHolidays.checked));
  queueUserSettingsSave();
  render();
});

mobileNavButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = String(button.dataset.action ?? '').trim();
    if (action === 'calendars') {
      openMobileCalendarsModal();
      return;
    }
    if (action === 'search') {
      openMobileSearchPrompt();
      return;
    }
    const view = button.dataset.view;
    if (!view) return;
    if (view === 'workflows') {
      setWorkflowViewMode('runs');
      setMobileWorkflowPanelMode('list');
    }
    if (view === 'shopping') {
      setMobileShoppingPanelMode('list');
    }
    if (view === 'tasks') {
      setActiveTaskFilter('all');
      clearActiveWorkflowChecklistInstanceId();
    }
    setActiveView(view);
    render();
  });
});

mobileNavAdd?.addEventListener('click', () => {
  handleMobileQuickAdd();
});

function toggleMobileTopMenu(event) {
  if (!isMobileViewport() || !mobileTopMenu) return;
  event?.stopPropagation?.();
  if (openMenu && openMenu !== mobileTopMenu) {
    openMenu.classList.add('hidden');
  }
  const opening = mobileTopMenu.classList.contains('hidden');
  if (opening) {
    mobileTopMenu.classList.remove('hidden');
    openMenu = mobileTopMenu;
  } else {
    mobileTopMenu.classList.add('hidden');
    openMenu = null;
  }
}

function toggleMobileTitleMenu(event) {
  if (!isMobileViewport() || !mobileTitleMenu) return;
  event?.stopPropagation?.();
  if (openMenu && openMenu !== mobileTitleMenu) {
    openMenu.classList.add('hidden');
  }
  const opening = mobileTitleMenu.classList.contains('hidden');
  if (opening) {
    mobileTitleMenu.classList.remove('hidden');
    openMenu = mobileTitleMenu;
  } else {
    mobileTitleMenu.classList.add('hidden');
    openMenu = null;
  }
  appTitleTrigger?.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

mobileTopMenuButton?.addEventListener('click', (event) => {
  toggleMobileTopMenu(event);
});

appTitleTrigger?.addEventListener('click', (event) => {
  toggleMobileTitleMenu(event);
});

appTitleTrigger?.addEventListener('keydown', (event) => {
  if (!isMobileViewport()) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleMobileTitleMenu(event);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMobileTitleMenu();
  }
});

mobileTopMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

mobileTitleMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

mobileMenuTasks?.addEventListener('click', () => {
  closeMobileTitleMenu();
  setActiveTaskFilter('all');
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});

mobileMenuScheduling?.addEventListener('click', () => {
  closeMobileTitleMenu();
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('scheduling');
  render();
});

mobileMenuNotices?.addEventListener('click', () => {
  closeMobileTopMenu();
  setActiveView('notices');
  render();
});

mobileMenuSettings?.addEventListener('click', () => {
  closeMobileTopMenu();
  openSettings();
});

mobileMenuProfile?.addEventListener('click', () => {
  closeMobileTopMenu();
  openProfile();
});

mobileMenuWorkspaces?.addEventListener('click', () => {
  closeMobileTopMenu();
  setActiveView('workspaces-manage');
  render();
});

mobileMenuAuth?.addEventListener('click', () => {
  closeMobileTopMenu();
  accountLogout?.click();
});

authCancel?.addEventListener('click', closeAuthModal);
authCancelInvite?.addEventListener('click', closeAuthModal);
authModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeAuthModal);
authOpenInvite?.addEventListener('click', () => setAuthModalMode('invite'));
authBackLogin?.addEventListener('click', () => setAuthModalMode('login'));

authLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAuthLogin();
});

authInviteForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitInviteAccept();
});

mobileCreateSheetBackdrop?.addEventListener('click', () => {
  closeMobileCreateSheet();
});

mobileCreateSheetClose?.addEventListener('click', () => {
  closeMobileCreateSheet();
});

mobileTaskQuickAddCancel?.addEventListener('click', () => {
  closeMobileCreateSheet();
});

mobileSearchBackdrop?.addEventListener('click', () => {
  closeMobileSearchModal();
});

mobileSearchClose?.addEventListener('click', () => {
  closeMobileSearchModal();
});

mobileSearchInput?.addEventListener('input', () => {
  setGlobalSearchQuery(mobileSearchInput.value);
  renderMobileSearchResults();
});

mobileSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMobileSearchModal();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const results = getGlobalSearchResults(getGlobalSearchQuery());
    const primary = getGlobalSearchPrimaryResult(results, getGlobalSearchScope());
    if (!primary) {
      showToast({ type: 'info', message: 'No results found.' });
      return;
    }
    closeMobileSearchModal();
    handleGlobalSearchResultSelect(primary.kind, primary.id);
  }
});

mobileSearchResults?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const scopeChip = target.closest('[data-scope]');
  if (scopeChip) {
    const scope = String(scopeChip.getAttribute('data-scope') ?? '');
    setGlobalSearchScope(scope);
    renderMobileSearchResults();
    return;
  }
  const resultButton = target.closest('.global-search-result');
  if (!resultButton) return;
  const kind = String(resultButton.getAttribute('data-kind') ?? '');
  const id = String(resultButton.getAttribute('data-id') ?? '');
  if (!kind || !id) return;
  closeMobileSearchModal();
  handleGlobalSearchResultSelect(kind, id);
});

mobileCalendarsBackdrop?.addEventListener('click', () => {
  closeMobileCalendarsModal();
});

mobileCalendarsClose?.addEventListener('click', () => {
  closeMobileCalendarsModal();
});

mobileCalendarAdd?.addEventListener('click', () => {
  openScheduleCalendarCreatePrompt();
});

mobileCalendarList?.addEventListener('change', (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target || !target.matches('.schedule-calendar-toggle')) return;
  const calendarId = String(target.dataset.calendarId ?? '').trim();
  if (!calendarId) return;
  setSchedulingCalendarVisible(calendarId, target.checked);
  queueUserSettingsSave();
  render();
});

mobileCalendarList?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const actionButton = target.closest('button[data-calendar-action]');
  if (!actionButton) return;
  const action = String(actionButton.getAttribute('data-calendar-action') ?? '');
  const calendarId = String(actionButton.getAttribute('data-calendar-id') ?? '');
  if (!calendarId) return;
  if (action === 'edit') {
    openScheduleCalendarEditPrompt(calendarId);
    return;
  }
  if (action === 'delete') {
    deleteScheduleCalendarFromUi(calendarId);
  }
});

mobileCalendarLayerEvent?.addEventListener('change', () => {
  setSchedulingKindVisible('event', Boolean(mobileCalendarLayerEvent.checked));
  queueUserSettingsSave();
  render();
});

mobileCalendarLayerTimeBlock?.addEventListener('change', () => {
  setSchedulingKindVisible('time-block', Boolean(mobileCalendarLayerTimeBlock.checked));
  queueUserSettingsSave();
  render();
});

mobileCalendarLayerDayOff?.addEventListener('change', () => {
  setSchedulingKindVisible('day-off', Boolean(mobileCalendarLayerDayOff.checked));
  queueUserSettingsSave();
  render();
});

mobileCalendarLayerTasks?.addEventListener('change', () => {
  setSchedulingShowTasks(Boolean(mobileCalendarLayerTasks.checked));
  queueUserSettingsSave();
  render();
});

mobileCalendarLayerHolidays?.addEventListener('change', () => {
  setCalendarIncludeHolidays(Boolean(mobileCalendarLayerHolidays.checked));
  queueUserSettingsSave();
  render();
});

mobileCreateTask?.addEventListener('click', () => {
  openMobileTaskQuickAdd();
});

mobileCreateNotice?.addEventListener('click', () => {
  closeMobileCreateSheet();
  runMobileCreateAction('notice');
});

mobileCreateWorkflow?.addEventListener('click', () => {
  closeMobileCreateSheet();
  runMobileCreateAction('workflow');
});

mobileCreateShopping?.addEventListener('click', () => {
  closeMobileCreateSheet();
  runMobileCreateAction('shopping');
});

newWorkflowBtn?.addEventListener('click', () => {
  openWorkflowModal();
});

workflowMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!workflowMenu) return;
  if (openMenu && openMenu !== workflowMenu) {
    openMenu.classList.add('hidden');
  }
  if (workflowMenu.classList.contains('hidden')) {
    workflowMenu.classList.remove('hidden');
    openMenu = workflowMenu;
  } else {
    workflowMenu.classList.add('hidden');
    openMenu = null;
  }
});

workflowMenu?.addEventListener('click', (event) => event.stopPropagation());

workflowRenameBtn?.addEventListener('click', () => {
  const workflow = getWorkflowById(getActiveWorkflowId());
  if (!workflow) return;
  workflowMenu?.classList.add('hidden');
  openMenu = null;
  openWorkflowModal(workflow);
});

workflowDeleteBtn?.addEventListener('click', () => {
  const workflow = getWorkflowById(getActiveWorkflowId());
  if (!workflow) return;
  const confirmed = confirm(`Delete blueprint "${workflow.name}"? Workflows will be removed, tasks will remain.`);
  if (!confirmed) return;
  workflowMenu?.classList.add('hidden');
  openMenu = null;
  deleteWorkflowRecord(workflow.id);
  setActiveWorkflowId(null);
  setActiveWorkflowVariantId(null);
  render();
});

workflowInstanceAddBtn?.addEventListener('click', () => {
  const isManageView = !isMobileViewport() && getActiveView() === 'workflows' && getWorkflowViewMode() === 'manage';
  if (isManageView) {
    exitWorkflowManageView();
    render();
    return;
  }
  enterWorkflowManageView();
  render();
  openWorkflowModal();
});

noticeCancel?.addEventListener('click', closeNoticeModal);
noticeModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeNoticeModal);
noticeDismissBtn?.addEventListener('click', async () => {
  if (!activeNoticeId) return;
  const notice = (state.notices ?? []).find(item => item.id === activeNoticeId);
  if (!notice) return;
  await dismissNoticeWithUndo(notice);
  closeNoticeModal();
});
noticeType?.addEventListener('change', () => {
  if (noticeType.value === '__add_new__') {
    openNoticeTypeModal();
    return;
  }
  noticeTypePreviousKey = noticeType.value;
  if (isBirthdayNoticeType(noticeType.value) && noticeRepeatPreset?.value === 'none') {
    noticeRepeatPreset.value = 'yearly';
  }
});
noticeTypeCancel?.addEventListener('click', () => closeNoticeTypeModal({ restoreSelection: true }));
noticeTypeModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeNoticeTypeModal({ restoreSelection: true }));
noticeTypeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = noticeTypeNameInput?.value?.trim();
  if (!label) return;
  const created = await createNoticeTypeRecord({ label });
  if (created) {
    renderNoticeTypeSelect(created.key);
  } else {
    renderNoticeTypeSelect(noticeTypePreviousKey);
  }
  closeNoticeTypeModal({ restoreSelection: false });
});
noticeRepeatPreset?.addEventListener('change', () => {
  if (noticeRepeatPreset.value !== 'custom') return;
  openNoticeRecurrenceModal();
});
noticeCustomUnit?.addEventListener('change', () => {
  toggleCustomWeekdayRow();
  if (noticeCustomUnit.value !== 'week') {
    applyCustomWeekdaySelection([]);
  }
});
noticeCustomWeekdays?.querySelectorAll('.weekday-chip').forEach(button => {
  button.addEventListener('click', () => {
    const isActive = button.classList.contains('active');
    button.classList.toggle('active', !isActive);
  });
});
noticeRecurrenceCancel?.addEventListener('click', () => closeNoticeRecurrenceModal({ restorePreset: true }));
noticeRecurrenceModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeNoticeRecurrenceModal({ restorePreset: true }));
noticeRecurrenceForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const rule = readCustomRecurrenceForm();
  if (!rule) return;
  if (rule.unit === 'week' && !rule.weekdays.length) return;
  noticeRecurrenceDraft = rule;
  if (noticeRepeatPreset) noticeRepeatPreset.value = 'custom';
  closeNoticeRecurrenceModal();
});

noticeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (noticeModalMode === 'view') {
    const existing = activeNoticeId ? (state.notices ?? []).find(item => item.id === activeNoticeId) : null;
    if (!existing) return;
    setNoticeModalMode('edit', existing);
    noticeTitle.focus();
    noticeTitle.select();
    return;
  }
  const title = noticeTitle.value.trim();
  if (!title) return;
  const noticeDateValue = noticeDate?.value?.trim() ?? '';
  if (!noticeDateValue) return;
  const existing = activeNoticeId ? (state.notices ?? []).find(item => item.id === activeNoticeId) : null;
  const fallbackTimeIso = existing?.created_at ?? nowIso();
  const notifyAt = combineDateAndTimeToIso(noticeDateValue, noticeTime?.value?.trim() ?? '', fallbackTimeIso);
  if (!notifyAt) return;
  let repeatPreset = noticeRepeatPreset?.value ?? 'none';
  let recurrenceRule = buildNoticeRecurrenceRuleFromPreset(repeatPreset, notifyAt);
  if (repeatPreset === 'custom' && !recurrenceRule) {
    openNoticeRecurrenceModal();
    return;
  }
  const legacyRecurrence = ruleToLegacyRecurrence(recurrenceRule);
  const typeValue = noticeType?.value ?? 'general';
  if (typeValue === '__add_new__') {
    openNoticeTypeModal();
    return;
  }
  if (isBirthdayNoticeType(typeValue) && !recurrenceRule) {
    repeatPreset = 'yearly';
    recurrenceRule = buildNoticeRecurrenceRuleFromPreset(repeatPreset, notifyAt);
    if (noticeRepeatPreset) noticeRepeatPreset.value = repeatPreset;
  }
  if (activeNoticeId) {
    await updateNoticeRecord(activeNoticeId, {
      title,
      notify_at: notifyAt,
      notice_type: typeValue,
      recurrence_interval: legacyRecurrence.interval,
      recurrence_unit: legacyRecurrence.unit,
      recurrence_rule_json: recurrenceRule ? JSON.stringify(recurrenceRule) : null,
      recurrence_occurrence_count: existing?.recurrence_occurrence_count ?? 0
    });
  } else {
    await createNoticeRecord({
      title,
      notify_at: notifyAt,
      notice_type: typeValue,
      recurrence_interval: legacyRecurrence.interval,
      recurrence_unit: legacyRecurrence.unit,
      recurrence_rule_json: recurrenceRule ? JSON.stringify(recurrenceRule) : null,
      recurrence_occurrence_count: 0
    });
  }
  closeNoticeModal();
  render();
});

checkinYes?.addEventListener('click', async () => {
  await resolveCheckin('yes');
});
checkinNo?.addEventListener('click', async () => {
  if (!activeCheckinTaskId) return;
  const task = state.tasks[activeCheckinTaskId];
  if (task && isTaskOverdue(task)) {
    closeCheckinModal();
    openCheckinNoModal(task, 'no', 'checkin');
    return;
  }
  await resolveCheckin('no');
});
checkinInProgress?.addEventListener('click', async () => {
  if (!activeCheckinTaskId) return;
  const task = state.tasks[activeCheckinTaskId];
  if (task && isTaskOverdue(task)) {
    closeCheckinModal();
    openCheckinProgressModal(task);
    return;
  }
  await resolveCheckin('in-progress');
});
checkinDismiss?.addEventListener('click', () => {
  dismissCheckin();
});
checkinModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  dismissCheckin();
});
checkinProgressYes?.addEventListener('click', async () => {
  const taskId = checkinProgressTaskId;
  closeCheckinProgressModal();
  if (!taskId) return;
  activeCheckinTaskId = taskId;
  await resolveCheckin('in-progress');
});
checkinProgressNo?.addEventListener('click', () => {
  const taskId = checkinProgressTaskId;
  closeCheckinProgressModal();
  if (!taskId) return;
  const task = state.tasks[taskId];
  if (!task) return;
  openCheckinNoModal(task, 'in-progress', 'progress');
});
checkinProgressModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  if (checkinProgressTaskId) snoozeCheckin(checkinProgressTaskId, 30);
  closeCheckinProgressModal();
});
checkinProgressBack?.addEventListener('click', () => {
  const taskId = checkinProgressTaskId;
  closeCheckinProgressModal();
  if (!taskId) return;
  const task = state.tasks[taskId];
  if (!task) return;
  openCheckinModal(task);
});
checkinNoExtend?.addEventListener('click', async () => {
  if (!checkinRescheduleContext) return;
  closeCheckinNoModal();
  const minutes = getCheckinExtendMinutes();
  const dueAt = addMinutes(new Date(), minutes).toISOString();
  await applyCheckinReschedule({ due_at: dueAt });
});
checkinNoFirst?.addEventListener('click', async () => {
  if (!checkinRescheduleContext) return;
  closeCheckinNoModal();
  const task = state.tasks[checkinRescheduleContext.taskId];
  if (!task) return;
  const response = checkinRescheduleContext.response;
  const targetStatus = response === 'no'
    ? (getStatusKeyByKind(TaskStatus.PLANNED) ?? getDefaultStatusKey())
    : (getStatusKeyByKind(TaskStatus.IN_PROGRESS) ?? getDefaultStatusKey());
  const sortOrder = getFirstTaskSortOrder(task.parent_id ?? null, task.parent_id ? null : targetStatus);
  const dueAt = addMinutes(new Date(), 1).toISOString();
  await applyCheckinReschedule({ due_at: dueAt, sort_order: sortOrder });
});
checkinNoReschedule?.addEventListener('click', () => {
  if (!checkinRescheduleContext) return;
  closeCheckinNoModal();
  const task = state.tasks[checkinRescheduleContext.taskId];
  if (!task) return;
  openCheckinRescheduleModal(task, checkinRescheduleContext.response, checkinRescheduleContext.origin);
});
checkinNoDismiss?.addEventListener('click', () => {
  dismissCheckinNo();
});
checkinNoModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  dismissCheckinNo();
});
checkinNoBack?.addEventListener('click', () => {
  const context = checkinRescheduleContext;
  closeCheckinNoModal();
  checkinRescheduleContext = null;
  if (!context) return;
  const task = state.tasks[context.taskId];
  if (!task) return;
  if (context.origin === 'progress') {
    openCheckinProgressModal(task);
    return;
  }
  openCheckinModal(task);
});
checkinRescheduleApply?.addEventListener('click', async () => {
  if (!checkinRescheduleContext) return;
  const customValue = checkinCustomDue?.value ?? '';
  const dueAt = fromDatetimeLocal(customValue);
  if (!dueAt) return;
  await applyCheckinReschedule({ due_at: dueAt });
});
checkinRescheduleCancel?.addEventListener('click', () => {
  dismissCheckinReschedule();
});
checkinRescheduleModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  dismissCheckinReschedule();
});
checkinRescheduleBack?.addEventListener('click', () => {
  const context = checkinRescheduleContext;
  closeCheckinRescheduleModal();
  if (!context) return;
  const task = state.tasks[context.taskId];
  if (!task) return;
  openCheckinNoModal(task, context.response, context.origin);
});
checkinDefaultMinutesInput?.addEventListener('change', () => {
  const value = Number(checkinDefaultMinutesInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    checkinDefaultMinutesInput.value = String(getCheckinExtendMinutes());
    return;
  }
  setCheckinExtendMinutes(value);
  if (checkinNoModal && !checkinNoModal.classList.contains('hidden') && checkinNoExtend) {
    checkinNoExtend.textContent = `Extend session (${value} min)`;
  }
  queueUserSettingsSave();
  render();
});

taskUiQuickAddInput?.addEventListener('change', () => {
  setTaskQuickAddVisible(Boolean(taskUiQuickAddInput.checked));
  queueUserSettingsSave();
  render();
});

taskUiCompletedVisibilitySelect?.addEventListener('change', () => {
  setTaskCompletedVisibility(taskUiCompletedVisibilitySelect.value || 'show');
  queueUserSettingsSave();
  render();
});

taskUiFutureDaysInput?.addEventListener('change', () => {
  const value = Number(taskUiFutureDaysInput.value);
  if (!Number.isFinite(value) || value < 0) {
    taskUiFutureDaysInput.value = String(getTaskFutureVisibilityDays());
    return;
  }
  setTaskFutureVisibilityDays(value);
  queueUserSettingsSave();
  render();
});

taskUiFilterSelect?.addEventListener('change', () => {
  const selected = taskUiFilterSelect.value || 'all';
  setActiveTaskFilter(selected);
  clearActiveWorkflowChecklistInstanceId();
  scheduleTaskSearchRefresh(true);
  setActiveView('tasks');
  queueUserSettingsSave();
  render();
});

taskUiSortSelect?.addEventListener('change', () => {
  const selected = taskUiSortSelect.value || 'default';
  setTaskSortKey(selected);
  queueUserSettingsSave();
  render();
});

taskUiGroupSelect?.addEventListener('change', () => {
  setTaskGroupMode(taskUiGroupSelect.value || 'none');
  queueUserSettingsSave();
  render();
});

taskUiViewSelect?.addEventListener('change', () => {
  setTaskView(taskUiViewSelect.value || 'list');
  queueUserSettingsSave();
  render();
});

schedulingUiWeekModeSelect?.addEventListener('change', () => {
  setSchedulingWeekMode(schedulingUiWeekModeSelect.value || 'seven');
  queueUserSettingsSave();
  render();
});

schedulingUiTimeZoneInput?.addEventListener('change', () => {
  const rawValue = String(schedulingUiTimeZoneInput.value ?? '').trim();
  if (!rawValue) {
    schedulingUiTimeZoneInput.value = getSchedulingDisplayTimeZone();
    return;
  }
  const normalized = normalizeTimeZone(rawValue, '');
  if (!normalized) {
    schedulingUiTimeZoneInput.value = getSchedulingDisplayTimeZone();
    alert('Please enter a valid IANA time zone (example: America/Los_Angeles).');
    return;
  }
  setSchedulingDisplayTimeZone(normalized);
  queueUserSettingsSave();
  render();
});

schedulingUiDefaultDurationInput?.addEventListener('change', () => {
  const value = Number(schedulingUiDefaultDurationInput.value);
  if (!Number.isFinite(value)) {
    schedulingUiDefaultDurationInput.value = String(getSchedulingDefaultEventDurationMinutes());
    return;
  }
  setSchedulingDefaultEventDurationMinutes(value);
  schedulingUiDefaultDurationInput.value = String(getSchedulingDefaultEventDurationMinutes());
  queueUserSettingsSave();
  render();
});

taskColumnsClose?.addEventListener('click', closeTaskColumnsModal);
taskColumnsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTaskColumnsModal);

taskColumnAdd?.addEventListener('click', async () => {
  const label = taskColumnName?.value?.trim();
  if (!label) return;
  await createStatusRecord(label);
  if (taskColumnName) taskColumnName.value = '';
  render();
});

taskTypeAddBtn?.addEventListener('click', async () => {
  const name = taskTypeNameInput?.value?.trim();
  if (!name) return;
  try {
    await createTaskTypeRecord(name);
    if (taskTypeNameInput) taskTypeNameInput.value = '';
    render();
  } catch (err) {
    alert(err.message || 'Unable to add task type.');
  }
});

scheduleEventTypeAddBtn?.addEventListener('click', () => {
  const name = scheduleEventTypeNameInput?.value?.trim();
  if (!name) return;
  const defaultColor = normalizeScheduleEventColor(scheduleEventTypeColorInput?.value ?? '')
    ?? getNextScheduleEventTypeColor();
  const template = String(scheduleEventTypeTemplateInput?.value ?? '');
  const created = createScheduleEventTypeRecord({
    name,
    default_color: defaultColor,
    description_template: template
  });
  if (created?.duplicate) {
    alert('An event type with that name already exists.');
    return;
  }
  if (!created) return;
  if (scheduleEventTypeNameInput) scheduleEventTypeNameInput.value = '';
  if (scheduleEventTypeColorInput) scheduleEventTypeColorInput.value = getNextScheduleEventTypeColor();
  if (scheduleEventTypeTemplateInput) scheduleEventTypeTemplateInput.value = '';
  render();
});

storeRuleAddBtn?.addEventListener('click', async () => {
  const storeName = storeRuleNameInput?.value?.trim();
  if (!storeName) return;
  const keywords = parseStoreKeywords(storeRuleKeywordsInput?.value ?? '');
  try {
    await createStoreRuleRecord({ store_name: storeName, keywords });
    if (storeRuleNameInput) storeRuleNameInput.value = '';
    if (storeRuleKeywordsInput) storeRuleKeywordsInput.value = '';
    render();
  } catch (err) {
    alert(err.message || 'Unable to add store.');
  }
});

shoppingListSidebarMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== shoppingListSidebarMenu) {
    openMenu.classList.add('hidden');
  }
  if (shoppingListSidebarMenu.classList.contains('hidden')) {
    shoppingListSidebarMenu.classList.remove('hidden');
    openMenu = shoppingListSidebarMenu;
  } else {
    shoppingListSidebarMenu.classList.add('hidden');
    openMenu = null;
  }
});

shoppingListSidebarMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

workflowSidebarMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== workflowSidebarMenu) {
    openMenu.classList.add('hidden');
  }
  if (workflowSidebarMenu?.classList.contains('hidden')) {
    workflowSidebarMenu.classList.remove('hidden');
    openMenu = workflowSidebarMenu;
  } else {
    workflowSidebarMenu?.classList.add('hidden');
    openMenu = null;
  }
});

workflowSidebarMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

workflowSidebarManage?.addEventListener('click', () => {
  workflowSidebarMenu?.classList.add('hidden');
  openMenu = null;
  enterWorkflowManageView();
  render();
});

shoppingListMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  if (openMenu && openMenu !== shoppingListMenu) {
    openMenu.classList.add('hidden');
  }
  if (shoppingListMenu.classList.contains('hidden')) {
    shoppingListMenu.classList.remove('hidden');
    openMenu = shoppingListMenu;
  } else {
    shoppingListMenu.classList.add('hidden');
    openMenu = null;
  }
});

shoppingListMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

function nowIso() {
  return new Date().toISOString();
}

function ensureAuditLogArray() {
  if (!Array.isArray(state.auditLog)) {
    state.auditLog = [];
  }
  if (!auditLogSanitized) {
    state.auditLog = state.auditLog.filter(entry => AUDIT_LOG_ALLOWED_CATEGORIES.has(String(entry?.category ?? '').toLowerCase()));
    auditLogSanitized = true;
  }
  return state.auditLog;
}

function sanitizeAuditValue(value, depth = 0) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[max-depth]';
  if (Array.isArray(value)) {
    return value.slice(0, 40).map(item => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 40);
    const next = {};
    entries.forEach(([key, item]) => {
      next[key] = sanitizeAuditValue(item, depth + 1);
    });
    return next;
  }
  return String(value);
}

function appendAuditEvent(entry = {}) {
  const list = ensureAuditLogArray();
  const category = String(entry.category ?? '').toLowerCase();
  if (!AUDIT_LOG_ALLOWED_CATEGORIES.has(category)) {
    return null;
  }
  const event = {
    id: createId(),
    ts: nowIso(),
    source: entry.source ?? 'app',
    category,
    event: entry.event ?? 'unknown',
    workspace_id: entry.workspace_id ?? state.workspace?.id ?? null,
    view: entry.view ?? getActiveView(),
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    data: sanitizeAuditValue(entry.data ?? null)
  };
  list.push(event);
  const extra = list.length - AUDIT_LOG_MAX_ENTRIES;
  if (extra > 0) {
    list.splice(0, extra);
  }
  if ((settingsModal && !settingsModal.classList.contains('hidden')) || getActiveView() === 'audit-log') {
    renderAuditLogOutput();
  }
  return event;
}

function appendCrudEvent(entry = {}) {
  appendAuditEvent({
    ...entry,
    category: 'crud'
  });
}

function getAuditFilterValue() {
  return auditLogFilter?.value ?? 'all';
}

function getFilteredAuditLogEntries() {
  const entries = ensureAuditLogArray();
  const filter = getAuditFilterValue();
  if (filter === 'all') return entries;
  return entries.filter(entry => entry.category === filter);
}

function renderAuditLogOutput() {
  if (!auditLogOutput) return;
  const entries = getFilteredAuditLogEntries();
  auditLogOutput.value = JSON.stringify(entries, null, 2);
}

async function copyAuditLogOutput() {
  if (!auditLogOutput) return;
  const content = auditLogOutput.value ?? '';
  if (!content.trim()) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  auditLogOutput.focus();
  auditLogOutput.select();
  document.execCommand('copy');
}

async function copyTextToClipboard(value) {
  const text = String(value ?? '');
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  document.execCommand('copy');
  helper.remove();
}

function clearAuditLogOutput() {
  const list = ensureAuditLogArray();
  list.length = 0;
  renderAuditLogOutput();
}

function sanitizeExportFilenamePart(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'workspace';
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'workspace';
}

function downloadExportBlob(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getWorkspaceExportPayload(workspaceId, options = {}) {
  const includeAudit = options.includeAudit !== false;
  if (!workspaceId) return null;
  const workspace = (state.workspaces ?? []).find(item => item.id === workspaceId) ?? null;
  if (!workspace) return null;

  const tasks = Object.values(state.tasks ?? {})
    .filter(task => task.workspace_id === workspaceId)
    .map(task => ({ ...task }));
  const taskIdSet = new Set(tasks.map(task => task.id));
  const taskDependencies = (state.taskDependencies ?? [])
    .filter(dep => taskIdSet.has(dep.task_id))
    .map(dep => ({ ...dep }));

  const projects = (state.projects ?? [])
    .filter(project => project.workspace_id === workspaceId)
    .map(project => ({ ...project }));
  const statuses = (state.statuses ?? [])
    .filter(status => status.workspace_id === workspaceId)
    .map(status => ({ ...status }));
  const taskTypes = (state.taskTypes ?? [])
    .filter(type => type.workspace_id === workspaceId)
    .map(type => ({ ...type }));
  const taskSections = (state.taskSections ?? [])
    .filter(section => section.workspace_id === workspaceId)
    .map(section => ({ ...section }));
  const templates = (state.templates ?? [])
    .filter(template => template.workspace_id === workspaceId)
    .map(template => ({ ...template }));
  const workspaceMemberships = (state.workspaceMemberships ?? [])
    .filter(item => item.workspace_id === workspaceId)
    .map(item => ({ ...item }));
  const userIds = new Set(workspaceMemberships.map(item => item.user_id));
  tasks.forEach((task) => {
    if (task.assignee_user_id) userIds.add(task.assignee_user_id);
  });
  const users = (state.users ?? [])
    .filter(user => userIds.has(user.id))
    .map(user => ({ ...user }));
  const notices = (state.notices ?? [])
    .filter(notice => notice.workspace_id === workspaceId)
    .map(notice => ({ ...notice }));
  const noticeTypes = (state.noticeTypes ?? [])
    .filter(type => type.workspace_id === workspaceId)
    .map(type => ({ ...type }));
  const storeRules = (state.storeRules ?? [])
    .filter(rule => rule.workspace_id === workspaceId)
    .map(rule => ({ ...rule }));

  const shoppingLists = (state.shoppingLists ?? [])
    .filter(list => list.workspace_id === workspaceId)
    .map(list => ({ ...list }));
  const shoppingListIdSet = new Set(shoppingLists.map(list => list.id));
  const shoppingItems = Object.values(state.shoppingItems ?? {})
    .filter(item => shoppingListIdSet.has(item.list_id))
    .map(item => ({ ...item }));

  const workflows = (state.workflows ?? [])
    .filter(workflow => workflow.workspace_id === workspaceId)
    .map(workflow => ({ ...workflow }));
  const workflowIdSet = new Set(workflows.map(workflow => workflow.id));
  const workflowVariants = (state.workflowVariants ?? [])
    .filter(variant => workflowIdSet.has(variant.workflow_id))
    .map(variant => ({ ...variant }));
  const workflowVariantIdSet = new Set(workflowVariants.map(variant => variant.id));
  const workflowPhases = (state.workflowPhases ?? [])
    .filter(phase => workflowIdSet.has(phase.workflow_id))
    .map(phase => ({ ...phase }));
  const workflowPhaseIdSet = new Set(workflowPhases.map(phase => phase.id));
  const workflowVariantPhases = (state.workflowVariantPhases ?? [])
    .filter(link => workflowVariantIdSet.has(link.variant_id))
    .map(link => ({ ...link }));
  const workflowPhaseTasks = (state.workflowPhaseTasks ?? [])
    .filter(task => workflowPhaseIdSet.has(task.phase_id))
    .map(task => ({ ...task }));
  const workflowPatterns = (state.workflowPatterns ?? [])
    .filter(pattern => pattern.workspace_id === workspaceId)
    .map(pattern => ({ ...pattern }));
  const workflowPatternIdSet = new Set(workflowPatterns.map(pattern => pattern.id));
  const workflowPatternTasks = (state.workflowPatternTasks ?? [])
    .filter(task => workflowPatternIdSet.has(task.pattern_id))
    .map(task => ({ ...task }));
  const workflowInstances = (state.workflowInstances ?? [])
    .filter(instance => workflowIdSet.has(instance.workflow_id))
    .map(instance => ({ ...instance }));
  const workflowInstanceIdSet = new Set(workflowInstances.map(instance => instance.id));
  const workflowInstanceTasks = (state.workflowInstanceTasks ?? [])
    .filter(link => workflowInstanceIdSet.has(link.workflow_instance_id))
    .map(link => ({ ...link }));
  const scheduleCalendars = (state.scheduleCalendars ?? [])
    .filter(calendar => calendar.workspace_id === workspaceId)
    .map(calendar => ({ ...calendar }));
  const scheduleEventTypes = (state.scheduleEventTypes ?? [])
    .filter(type => type.workspace_id === workspaceId)
    .map(type => ({ ...type }));
  const scheduleEvents = (state.scheduleEvents ?? [])
    .filter(event => event.workspace_id === workspaceId)
    .map(event => ({ ...event }));

  const auditLog = includeAudit
    ? ensureAuditLogArray()
      .filter(entry => !entry.workspace_id || entry.workspace_id === workspaceId)
      .map(entry => ({ ...entry }))
    : [];

  return {
    meta: {
      format_version: 1,
      exported_at: nowIso(),
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      includes_audit_log: includeAudit
    },
    workspace: { ...workspace },
    projects,
    statuses,
    taskTypes,
    taskSections,
    tasks,
    taskDependencies,
    templates,
    users,
    workspaceMemberships,
    workflows,
    workflowVariants,
    workflowPhases,
    workflowVariantPhases,
    workflowPhaseTasks,
    workflowPatterns,
    workflowPatternTasks,
    workflowInstances,
    workflowInstanceTasks,
    scheduleCalendars,
    scheduleEventTypes,
    scheduleEvents,
    notices,
    noticeTypes,
    storeRules,
    shoppingLists,
    shoppingItems,
    auditLog
  };
}

function toCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildExportCsv(payload) {
  const columns = [
    'entity_type',
    'id',
    'workspace_id',
    'name',
    'title',
    'status',
    'priority',
    'parent_id',
    'project_id',
    'type_label',
    'start_at',
    'due_at',
    'notify_at',
    'archived',
    'created_at',
    'updated_at',
    'raw_json'
  ];
  const rows = [];
  const pushRows = (entityType, items = [], mapper = () => ({})) => {
    items.forEach((item) => {
      const base = mapper(item) ?? {};
      rows.push({
        entity_type: entityType,
        id: item?.id ?? '',
        workspace_id: item?.workspace_id ?? payload?.workspace?.id ?? '',
        name: '',
        title: '',
        status: '',
        priority: '',
        parent_id: '',
        project_id: '',
        type_label: '',
        start_at: '',
        due_at: '',
        notify_at: '',
        archived: '',
        created_at: item?.created_at ?? '',
        updated_at: item?.updated_at ?? '',
        ...base,
        raw_json: JSON.stringify(item ?? {})
      });
    });
  };

  pushRows('project', payload.projects, item => ({ name: item.name, archived: item.archived ? 1 : 0 }));
  pushRows('status', payload.statuses, item => ({ name: item.label, status: item.key }));
  pushRows('task_type', payload.taskTypes, item => ({ name: item.name, archived: item.archived ? 1 : 0 }));
  pushRows('task_section', payload.taskSections, item => ({
    name: item.label,
    project_id: item.project_id ?? ''
  }));
  pushRows('task', payload.tasks, item => ({
    title: item.title,
    status: item.status,
    priority: item.priority,
    parent_id: item.parent_id ?? '',
    project_id: item.project_id ?? '',
    type_label: item.type_label ?? '',
    start_at: item.start_at ?? '',
    due_at: item.due_at ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('task_dependency', payload.taskDependencies, item => ({
    title: item.task_id,
    parent_id: item.depends_on_id
  }));
  pushRows('template', payload.templates, item => ({
    name: item.name,
    project_id: item.project_id ?? '',
    due_at: item.next_event_date ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('user', payload.users, item => ({
    name: item.display_name ?? '',
    status: item.email ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('workspace_membership', payload.workspaceMemberships, item => ({
    title: item.user_id ?? '',
    status: item.role ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('workflow', payload.workflows, item => ({ name: item.name, archived: item.archived ? 1 : 0 }));
  pushRows('workflow_type', payload.workflowVariants, item => ({ name: item.name }));
  pushRows('workflow_phase', payload.workflowPhases, item => ({ name: item.name }));
  pushRows('workflow_type_phase', payload.workflowVariantPhases, item => ({
    parent_id: item.variant_id ?? '',
    project_id: item.phase_id ?? ''
  }));
  pushRows('workflow_phase_item', payload.workflowPhaseTasks, item => ({ title: item.title, status: item.item_kind ?? '' }));
  pushRows('workflow_pattern', payload.workflowPatterns, item => ({ name: item.name }));
  pushRows('workflow_pattern_item', payload.workflowPatternTasks, item => ({ title: item.title, status: item.item_kind ?? '' }));
  pushRows('workflow_instance', payload.workflowInstances, item => ({ title: item.title, status: item.status }));
  pushRows('workflow_instance_task', payload.workflowInstanceTasks, item => ({ title: item.task_id, status: item.dismissed_at ? 'dismissed' : 'active' }));
  pushRows('schedule_calendar', payload.scheduleCalendars, item => ({
    name: item.name,
    status: item.color ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('schedule_event_type', payload.scheduleEventTypes, item => ({
    name: item.name,
    status: item.description_template ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('schedule_event', payload.scheduleEvents, item => ({
    title: item.title,
    status: item.kind ?? '',
    parent_id: item.calendar_id ?? '',
    start_at: item.start_at ?? '',
    due_at: item.end_at ?? '',
    archived: item.archived ? 1 : 0
  }));
  pushRows('notice_type', payload.noticeTypes, item => ({ name: item.label, status: item.key }));
  pushRows('notice', payload.notices, item => ({
    title: item.title,
    status: item.notice_type ?? '',
    notify_at: item.notify_at ?? '',
    archived: item.dismissed_at ? 1 : 0
  }));
  pushRows('store_rule', payload.storeRules, item => ({ name: item.store_name, archived: item.archived ? 1 : 0 }));
  pushRows('shopping_list', payload.shoppingLists, item => ({ name: item.name, archived: item.archived ? 1 : 0 }));
  pushRows('shopping_item', payload.shoppingItems, item => ({ title: item.name, status: item.is_checked ? 'checked' : 'open', parent_id: item.list_id ?? '' }));
  pushRows('audit_event', payload.auditLog, item => ({ title: item.event, status: item.category, notify_at: item.ts ?? '' }));

  const lines = [columns.join(',')];
  rows.forEach((row) => {
    lines.push(columns.map(column => toCsvValue(row[column])).join(','));
  });
  return lines.join('\n');
}

function buildExportMarkdown(payload) {
  const tasks = [...(payload.tasks ?? [])].sort((a, b) => {
    const aSort = Number.isFinite(a.sort_order) ? a.sort_order : 0;
    const bSort = Number.isFinite(b.sort_order) ? b.sort_order : 0;
    return aSort - bSort || String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });
  const projects = [...(payload.projects ?? [])].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  const notices = [...(payload.notices ?? [])].sort((a, b) => String(a.notify_at ?? '').localeCompare(String(b.notify_at ?? '')));
  const shoppingLists = [...(payload.shoppingLists ?? [])].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  const shoppingItemsByList = new Map();
  (payload.shoppingItems ?? []).forEach((item) => {
    if (!shoppingItemsByList.has(item.list_id)) shoppingItemsByList.set(item.list_id, []);
    shoppingItemsByList.get(item.list_id).push(item);
  });

  const lines = [
    '# BrianHub Export',
    '',
    `- Exported: ${payload.meta?.exported_at ?? nowIso()}`,
    `- Workspace: ${payload.workspace?.name ?? 'Unknown'}`,
    `- Includes audit log: ${payload.meta?.includes_audit_log ? 'Yes' : 'No'}`,
    ''
  ];

  lines.push(`## Tasks (${tasks.length})`);
  if (!tasks.length) {
    lines.push('- None');
  } else {
    tasks.forEach((task) => {
      const done = isDoneStatusKey(task.status ?? getDefaultStatusKey());
      const check = done ? 'x' : ' ';
      const bits = [];
      if (task.status) bits.push(`status: ${task.status}`);
      if (task.priority) bits.push(`priority: ${task.priority}`);
      if (task.due_at) bits.push(`due: ${task.due_at}`);
      lines.push(`- [${check}] ${task.title} (${bits.join(' · ')})`);
    });
  }
  lines.push('');

  lines.push(`## Projects (${projects.length})`);
  if (!projects.length) {
    lines.push('- None');
  } else {
    projects.forEach((project) => {
      lines.push(`- ${project.name}${project.archived ? ' (archived)' : ''}`);
    });
  }
  lines.push('');

  lines.push(`## Notices (${notices.length})`);
  if (!notices.length) {
    lines.push('- None');
  } else {
    notices.forEach((notice) => {
      lines.push(`- ${notice.title} · ${notice.notify_at ?? 'No date'}${notice.dismissed_at ? ' (dismissed)' : ''}`);
    });
  }
  lines.push('');

  lines.push(`## Shopping Lists (${shoppingLists.length})`);
  if (!shoppingLists.length) {
    lines.push('- None');
  } else {
    shoppingLists.forEach((list) => {
      const items = shoppingItemsByList.get(list.id) ?? [];
      const completeCount = items.filter(item => item.is_checked).length;
      lines.push(`- ${list.name}${list.archived ? ' (archived)' : ''} · ${completeCount}/${items.length} complete`);
    });
  }
  lines.push('');

  lines.push(`## Workflows (${(payload.workflows ?? []).length})`);
  lines.push(`- Blueprints: ${(payload.workflows ?? []).length}`);
  lines.push(`- Types: ${(payload.workflowVariants ?? []).length}`);
  lines.push(`- Phases: ${(payload.workflowPhases ?? []).length}`);
  lines.push(`- Patterns: ${(payload.workflowPatterns ?? []).length}`);
  lines.push(`- Instances: ${(payload.workflowInstances ?? []).length}`);
  lines.push('');

  lines.push(`## Scheduling (${(payload.scheduleEvents ?? []).length})`);
  lines.push(`- Calendars: ${(payload.scheduleCalendars ?? []).length}`);
  lines.push(`- Event types: ${(payload.scheduleEventTypes ?? []).length}`);
  lines.push(`- Events: ${(payload.scheduleEvents ?? []).length}`);
  lines.push('');

  if (payload.meta?.includes_audit_log) {
    lines.push(`## Audit Events (${(payload.auditLog ?? []).length})`);
    const latest = [...(payload.auditLog ?? [])]
      .sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')))
      .slice(0, 20);
    if (!latest.length) {
      lines.push('- None');
    } else {
      latest.forEach((entry) => {
        lines.push(`- ${entry.ts ?? ''} · ${entry.category}/${entry.event}`);
      });
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Machine payload available in JSON export.');
  return lines.join('\n');
}

function escapeHtmlText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPdfExportWindow(payload, filename) {
  const markdown = buildExportMarkdown(payload);
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return false;
  const title = escapeHtmlText(filename);
  const body = escapeHtmlText(markdown);
  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { margin: 0; background: #10151d; color: #e6edf8; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
      main { padding: 24px; max-width: 1100px; margin: 0 auto; }
      h1 { font-size: 20px; margin: 0 0 16px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      pre { white-space: pre-wrap; word-break: break-word; line-height: 1.45; font-size: 12px; margin: 0; }
      @media print {
        body { background: white; color: black; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtmlText(payload.workspace?.name ?? 'Workspace Export')}</h1>
      <pre>${body}</pre>
    </main>
    <script>setTimeout(function(){ window.focus(); window.print(); }, 250);<\/script>
  </body>
</html>`);
  popup.document.close();
  return true;
}

function exportCurrentWorkspaceData() {
  if (!state.workspace) {
    alert('Select a workspace before exporting.');
    return;
  }
  const format = String(dataExportFormat?.value ?? 'json').toLowerCase();
  const includeAudit = Boolean(dataExportIncludeAudit?.checked);
  const payload = getWorkspaceExportPayload(state.workspace.id, { includeAudit });
  if (!payload) {
    alert('Unable to prepare export payload.');
    return;
  }

  const workspaceSlug = sanitizeExportFilenamePart(payload.workspace?.name ?? 'workspace');
  const dateStamp = nowIso().slice(0, 10);
  const baseName = `brianhub-${workspaceSlug}-${dateStamp}`;

  if (format === 'json') {
    const content = JSON.stringify(payload, null, 2);
    downloadExportBlob(content, 'application/json;charset=utf-8', `${baseName}.json`);
  } else if (format === 'csv') {
    const content = buildExportCsv(payload);
    downloadExportBlob(content, 'text/csv;charset=utf-8', `${baseName}.csv`);
  } else if (format === 'markdown' || format === 'md') {
    const content = buildExportMarkdown(payload);
    downloadExportBlob(content, 'text/markdown;charset=utf-8', `${baseName}.md`);
  } else if (format === 'pdf') {
    const opened = openPdfExportWindow(payload, `${baseName}.pdf`);
    if (!opened) {
      alert('Popup blocked. Allow popups to export PDF.');
      return;
    }
  } else {
    alert(`Unsupported export format: ${format}`);
    return;
  }

  appendAuditEvent({
    source: 'ui',
    category: 'export',
    event: 'workspace_exported',
    data: {
      format,
      include_audit_log: includeAudit,
      workspace_id: payload.workspace?.id ?? null
    }
  });
}

function cloneArrayOfObjects(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...item }));
}

function cloneTasksMap(value) {
  if (!value || typeof value !== 'object') return {};
  const entries = Array.isArray(value)
    ? value.map(item => [item?.id, item])
    : Object.entries(value);
  return Object.fromEntries(
    entries
      .filter(([id, item]) => id && item && typeof item === 'object')
      .map(([id, item]) => [id, { ...item }])
  );
}

function parseWorkspaceImportPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid import payload.');
  }
  const workspace = raw.workspace && typeof raw.workspace === 'object' ? { ...raw.workspace } : null;
  if (!workspace?.id) {
    throw new Error('Import payload is missing workspace.id.');
  }

  const tasksMap = cloneTasksMap(raw.tasks);
  const taskIdSet = new Set(Object.keys(tasksMap));
  const shoppingLists = cloneArrayOfObjects(raw.shoppingLists);
  const shoppingListIdSet = new Set(shoppingLists.map(list => list.id).filter(Boolean));
  const workflows = cloneArrayOfObjects(raw.workflows);
  const workflowIdSet = new Set(workflows.map(item => item.id).filter(Boolean));
  const users = cloneArrayOfObjects(raw.users)
    .filter(item => item.id && (item.org_id ? item.org_id === workspace.org_id : true));
  const userIdSet = new Set(users.map(item => item.id));
  const workspaceMemberships = cloneArrayOfObjects(raw.workspaceMemberships)
    .filter(item => item.workspace_id === workspace.id && userIdSet.has(item.user_id));
  const workflowVariants = cloneArrayOfObjects(raw.workflowVariants);
  const workflowVariantIdSet = new Set(workflowVariants.map(item => item.id).filter(Boolean));
  const workflowPhases = cloneArrayOfObjects(raw.workflowPhases);
  const workflowPhaseIdSet = new Set(workflowPhases.map(item => item.id).filter(Boolean));
  const workflowPatterns = cloneArrayOfObjects(raw.workflowPatterns);
  const workflowPatternIdSet = new Set(workflowPatterns.map(item => item.id).filter(Boolean));
  const workflowInstances = cloneArrayOfObjects(raw.workflowInstances);
  const workflowInstanceIdSet = new Set(workflowInstances.map(item => item.id).filter(Boolean));
  const scheduleCalendars = cloneArrayOfObjects(raw.scheduleCalendars)
    .filter(item => item.workspace_id === workspace.id);
  const scheduleCalendarIdSet = new Set(scheduleCalendars.map(item => item.id).filter(Boolean));
  const scheduleEventTypes = cloneArrayOfObjects(raw.scheduleEventTypes)
    .filter(item => item.workspace_id === workspace.id);
  const scheduleEventTypeIdSet = new Set(scheduleEventTypes.map(item => item.id).filter(Boolean));
  const hasScheduleEventTypes = scheduleEventTypes.length > 0;

  return {
    workspace,
    projects: cloneArrayOfObjects(raw.projects),
    statuses: cloneArrayOfObjects(raw.statuses),
    taskTypes: cloneArrayOfObjects(raw.taskTypes),
    taskSections: cloneArrayOfObjects(raw.taskSections).map(normalizeTaskSection),
    tasks: tasksMap,
    taskDependencies: cloneArrayOfObjects(raw.taskDependencies)
      .filter(dep => taskIdSet.has(dep.task_id) && taskIdSet.has(dep.depends_on_id)),
    templates: cloneArrayOfObjects(raw.templates),
    users,
    workspaceMemberships,
    workflows,
    workflowVariants: workflowVariants.filter(item => workflowIdSet.has(item.workflow_id)),
    workflowPhases: workflowPhases.filter(item => workflowIdSet.has(item.workflow_id)),
    workflowVariantPhases: cloneArrayOfObjects(raw.workflowVariantPhases)
      .filter(item => workflowVariantIdSet.has(item.variant_id) && workflowPhaseIdSet.has(item.phase_id)),
    workflowPhaseTasks: cloneArrayOfObjects(raw.workflowPhaseTasks)
      .filter(item => workflowPhaseIdSet.has(item.phase_id)),
    workflowPatterns: workflowPatterns.filter(item => item.workspace_id === workspace.id),
    workflowPatternTasks: cloneArrayOfObjects(raw.workflowPatternTasks)
      .filter(item => workflowPatternIdSet.has(item.pattern_id)),
    workflowInstances: workflowInstances.filter(item => workflowIdSet.has(item.workflow_id)),
    workflowInstanceTasks: cloneArrayOfObjects(raw.workflowInstanceTasks)
      .filter(item => workflowInstanceIdSet.has(item.workflow_instance_id) && taskIdSet.has(item.task_id)),
    scheduleCalendars,
    scheduleEventTypes,
    scheduleEvents: cloneArrayOfObjects(raw.scheduleEvents)
      .filter(item => item.workspace_id === workspace.id)
      .map(item => ({
        ...item,
        calendar_id: scheduleCalendarIdSet.has(item.calendar_id) ? item.calendar_id : null,
        event_type_id: hasScheduleEventTypes
          ? (scheduleEventTypeIdSet.has(item.event_type_id) ? item.event_type_id : null)
          : (item.event_type_id ?? null)
      })),
    notices: cloneArrayOfObjects(raw.notices),
    noticeTypes: cloneArrayOfObjects(raw.noticeTypes),
    storeRules: cloneArrayOfObjects(raw.storeRules),
    shoppingLists,
    shoppingItems: cloneArrayOfObjects(raw.shoppingItems)
      .filter(item => shoppingListIdSet.has(item.list_id)),
    auditLog: cloneArrayOfObjects(raw.auditLog)
  };
}

function applyImportedWorkspacePayload(payload, options = {}) {
  const replaceExisting = options.replaceExisting !== false;
  const workspaceId = payload.workspace.id;

  const existingWorkspace = (state.workspaces ?? []).find(item => item.id === workspaceId);
  const existingWorkspaceWorkflowIds = new Set(
    (state.workflows ?? [])
      .filter(item => item.workspace_id === workspaceId)
      .map(item => item.id)
  );
  const existingWorkspaceTaskIds = new Set(
    Object.values(state.tasks ?? {})
      .filter(task => task.workspace_id === workspaceId)
      .map(task => task.id)
  );
  const existingWorkspaceListIds = new Set(
    (state.shoppingLists ?? [])
      .filter(list => list.workspace_id === workspaceId)
      .map(list => list.id)
  );

  const normalizedWorkspace = normalizeWorkspace({ ...existingWorkspace, ...payload.workspace });
  const nextWorkspaces = (state.workspaces ?? []).filter(item => item.id !== workspaceId);
  state.workspaces = [...nextWorkspaces, normalizedWorkspace];

  const keepByWorkspace = (items = [], workspaceKey = 'workspace_id') => {
    if (!replaceExisting) return [...items];
    return items.filter(item => item[workspaceKey] !== workspaceId);
  };

  state.projects = [
    ...keepByWorkspace(state.projects),
    ...payload.projects.map(normalizeProject)
  ];
  state.statuses = [
    ...keepByWorkspace(state.statuses),
    ...payload.statuses.map(normalizeStatus)
  ];
  state.taskTypes = [
    ...keepByWorkspace(state.taskTypes),
    ...payload.taskTypes.map(normalizeTaskType)
  ];
  state.taskSections = [
    ...keepByWorkspace(state.taskSections),
    ...payload.taskSections.map(normalizeTaskSection)
  ];
  state.templates = [
    ...keepByWorkspace(state.templates),
    ...payload.templates.map(normalizeTemplate)
  ];
  const importedUsersById = new Map(payload.users.map(user => [user.id, normalizeUser(user)]));
  state.users = [
    ...(state.users ?? []).filter(user => !importedUsersById.has(user.id)),
    ...Array.from(importedUsersById.values())
  ];

  if (replaceExisting) {
    state.workspaceMemberships = (state.workspaceMemberships ?? [])
      .filter(item => item.workspace_id !== workspaceId);
  }
  const membershipById = new Map((state.workspaceMemberships ?? []).map(item => [item.id, item]));
  payload.workspaceMemberships.map(normalizeWorkspaceMembership).forEach((membership) => {
    membershipById.set(membership.id, membership);
  });
  state.workspaceMemberships = Array.from(membershipById.values());
  state.workflows = [
    ...keepByWorkspace(state.workflows),
    ...payload.workflows.map(normalizeWorkflow)
  ];

  if (replaceExisting) {
    const existingVariantIds = new Set(
      (state.workflowVariants ?? [])
        .filter(item => existingWorkspaceWorkflowIds.has(item.workflow_id))
        .map(item => item.id)
    );
    const existingPhaseIds = new Set(
      (state.workflowPhases ?? [])
        .filter(item => existingWorkspaceWorkflowIds.has(item.workflow_id))
        .map(item => item.id)
    );
    const existingInstanceIds = new Set(
      (state.workflowInstances ?? [])
        .filter(item => existingWorkspaceWorkflowIds.has(item.workflow_id))
        .map(item => item.id)
    );
    const existingPatternIds = new Set(
      (state.workflowPatterns ?? [])
        .filter(item => item.workspace_id === workspaceId)
        .map(item => item.id)
    );
    state.workflowVariants = (state.workflowVariants ?? []).filter(item => !existingWorkspaceWorkflowIds.has(item.workflow_id));
    state.workflowPhases = (state.workflowPhases ?? []).filter(item => !existingWorkspaceWorkflowIds.has(item.workflow_id));
    state.workflowVariantPhases = (state.workflowVariantPhases ?? []).filter(item => !existingVariantIds.has(item.variant_id));
    state.workflowPhaseTasks = (state.workflowPhaseTasks ?? []).filter(item => !existingPhaseIds.has(item.phase_id));
    state.workflowPatterns = (state.workflowPatterns ?? []).filter(item => item.workspace_id !== workspaceId);
    state.workflowPatternTasks = (state.workflowPatternTasks ?? []).filter(item => !existingPatternIds.has(item.pattern_id));
    state.workflowInstances = (state.workflowInstances ?? []).filter(item => !existingWorkspaceWorkflowIds.has(item.workflow_id));
    state.workflowInstanceTasks = (state.workflowInstanceTasks ?? []).filter(item => !existingInstanceIds.has(item.workflow_instance_id));
  }

  state.workflowVariants = [...(state.workflowVariants ?? []), ...payload.workflowVariants.map(normalizeWorkflowVariant)];
  state.workflowPhases = [...(state.workflowPhases ?? []), ...payload.workflowPhases.map(normalizeWorkflowPhase)];
  state.workflowVariantPhases = [...(state.workflowVariantPhases ?? []), ...payload.workflowVariantPhases];
  state.workflowPhaseTasks = [...(state.workflowPhaseTasks ?? []), ...payload.workflowPhaseTasks.map(normalizeWorkflowPhaseTask)];
  state.workflowPatterns = [...(state.workflowPatterns ?? []), ...payload.workflowPatterns.map(normalizeWorkflowPattern)];
  state.workflowPatternTasks = [...(state.workflowPatternTasks ?? []), ...payload.workflowPatternTasks.map(normalizeWorkflowPatternTask)];
  state.workflowInstances = [...(state.workflowInstances ?? []), ...payload.workflowInstances.map(normalizeWorkflowInstance)];
  state.workflowInstanceTasks = [...(state.workflowInstanceTasks ?? []), ...payload.workflowInstanceTasks.map(normalizeWorkflowInstanceTaskLink)];
  state.scheduleCalendars = [
    ...keepByWorkspace(state.scheduleCalendars),
    ...payload.scheduleCalendars.map(normalizeScheduleCalendar)
  ];
  state.scheduleEventTypes = [
    ...keepByWorkspace(state.scheduleEventTypes),
    ...payload.scheduleEventTypes.map(normalizeScheduleEventType)
  ];
  state.scheduleEvents = [
    ...keepByWorkspace(state.scheduleEvents),
    ...payload.scheduleEvents.map(normalizeScheduleEvent)
  ];

  state.notices = [
    ...keepByWorkspace(state.notices),
    ...payload.notices.map(normalizeNotice)
  ];
  state.noticeTypes = [
    ...keepByWorkspace(state.noticeTypes),
    ...payload.noticeTypes.map(normalizeNoticeType)
  ];
  state.storeRules = [
    ...keepByWorkspace(state.storeRules),
    ...payload.storeRules.map(normalizeStoreRule)
  ];
  state.shoppingLists = [
    ...keepByWorkspace(state.shoppingLists),
    ...payload.shoppingLists.map(normalizeShoppingList)
  ];

  if (replaceExisting) {
    Object.entries(state.shoppingItems ?? {}).forEach(([id, item]) => {
      if (existingWorkspaceListIds.has(item?.list_id)) {
        delete state.shoppingItems[id];
      }
    });
  }
  state.shoppingItems = state.shoppingItems ?? {};
  payload.shoppingItems.forEach((item) => {
    state.shoppingItems[item.id] = normalizeShoppingItem(item);
  });

  if (replaceExisting) {
    Object.entries(state.tasks ?? {}).forEach(([id, task]) => {
      if (task?.workspace_id === workspaceId || existingWorkspaceTaskIds.has(id)) {
        delete state.tasks[id];
      }
    });
    state.taskDependencies = (state.taskDependencies ?? []).filter(dep =>
      !existingWorkspaceTaskIds.has(dep.task_id) && !existingWorkspaceTaskIds.has(dep.depends_on_id)
    );
  }
  state.tasks = state.tasks ?? {};
  Object.entries(payload.tasks).forEach(([id, task]) => {
    state.tasks[id] = normalizeTask(task);
  });
  state.taskDependencies = [...(state.taskDependencies ?? []), ...payload.taskDependencies];

  if (Array.isArray(payload.auditLog) && payload.auditLog.length) {
    const existingById = new Set(ensureAuditLogArray().map(entry => entry.id));
    payload.auditLog.forEach((entry) => {
      if (!entry?.id || existingById.has(entry.id)) return;
      ensureAuditLogArray().push({ ...entry });
    });
  }

  state.local = state.local ?? {};
  state.local.localSeq = 0;
  state.local.pendingChanges = [];

  state.workspace = normalizedWorkspace;
  state.ui = state.ui ?? {};
  state.ui.activeWorkspaceId = normalizedWorkspace.id;
  state.ui.activeProjectId = null;
  state.ui.activeShoppingListId = null;
  state.ui.syncCursor = 0;
  state.ui.aiSuggestions = [];
  state.ui.aiSuggestionNotes = '';
  setActiveView('tasks');
  clearActiveWorkflowChecklistInstanceId();
  ensureLocalWorkspaceDefaults(state.workspace);
}

async function importWorkspaceFromJsonFile(file, options = {}) {
  if (!file) throw new Error('Select a JSON file first.');
  const text = await file.text();
  if (!text.trim()) throw new Error('Import file is empty.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Import file is not valid JSON.');
  }
  const payload = parseWorkspaceImportPayload(parsed);
  applyImportedWorkspacePayload(payload, options);
  appendAuditEvent({
    source: 'ui',
    category: 'import',
    event: 'workspace_imported',
    workspace_id: payload.workspace.id,
    data: {
      workspace_name: payload.workspace.name ?? '',
      replace_existing: options.replaceExisting !== false,
      task_count: Object.keys(payload.tasks).length
    }
  });
  render();
}

function normalizeAutomationDateInput(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const parsed = new Date(`${text}T${hours}:${minutes}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildAutomationTaskPatch(command = {}) {
  const patch = (command.patch && typeof command.patch === 'object')
    ? { ...command.patch }
    : {};
  const directKeys = [
    'title',
    'description_md',
    'status',
    'priority',
    'project_id',
    'parent_id',
    'assignee_user_id',
    'assignee_label',
    'type_label',
    'group_label',
    'start_at',
    'due_at',
    'reminder_offset_days',
    'recurrence_interval',
    'recurrence_unit'
  ];
  directKeys.forEach((key) => {
    if (command[key] !== undefined && patch[key] === undefined) {
      patch[key] = command[key];
    }
  });
  if (patch.start_at !== undefined) {
    patch.start_at = normalizeAutomationDateInput(patch.start_at);
  }
  if (patch.due_at !== undefined) {
    patch.due_at = normalizeAutomationDateInput(patch.due_at);
  }
  return patch;
}

async function runAutomationCommand(command = {}, index = 0) {
  const opRaw = command.op ?? command.action ?? '';
  const op = String(opRaw).trim().toLowerCase();
  if (!op) throw new Error(`Command ${index + 1}: missing op`);

  if (op === 'create_task') {
    const title = normalizeTitleInput(command.title ?? command.name ?? '');
    if (!title) throw new Error(`Command ${index + 1}: create_task requires title`);
    const created = await createTaskRecord({
      title,
      description_md: command.description_md ?? '',
      status: normalizeTaskStatusValue(command.status),
      priority: command.priority ?? 'medium',
      project_id: command.project_id ?? null,
      parent_id: command.parent_id ?? null,
      type_label: command.type_label ?? null,
      group_label: command.group_label ?? null,
      start_at: normalizeAutomationDateInput(command.start_at),
      due_at: normalizeAutomationDateInput(command.due_at),
      reminder_offset_days: command.reminder_offset_days ?? null
    });
    if (!created) throw new Error(`Command ${index + 1}: create_task failed`);
    appendCrudEvent({
      source: 'automation',
      event: 'create_task',
      entity_type: 'task',
      entity_id: created.id,
      data: { title: created.title }
    });
    return { op, entity_type: 'task', entity_id: created.id, title: created.title };
  }

  if (op === 'update_task') {
    const id = command.id ?? command.task_id ?? null;
    if (!id) throw new Error(`Command ${index + 1}: update_task requires id`);
    const patch = buildAutomationTaskPatch(command);
    const hasParentChange = patch.parent_id !== undefined || command.new_parent_id !== undefined;
    if (hasParentChange) {
      const parentId = command.new_parent_id !== undefined ? command.new_parent_id : patch.parent_id;
      await reparentTaskRecord(id, parentId ?? null);
      delete patch.parent_id;
    }
    const patchKeys = Object.keys(patch);
    if (patchKeys.length) {
      await updateTaskRecord(id, patch);
    }
    appendCrudEvent({
      source: 'automation',
      event: 'update_task',
      entity_type: 'task',
      entity_id: id,
      data: { fields: patchKeys }
    });
    return { op, entity_type: 'task', entity_id: id, updated_fields: patchKeys };
  }

  if (op === 'delete_task') {
    const id = command.id ?? command.task_id ?? null;
    if (!id) throw new Error(`Command ${index + 1}: delete_task requires id`);
    await deleteTaskRecord(id);
    appendCrudEvent({
      source: 'automation',
      event: 'delete_task',
      entity_type: 'task',
      entity_id: id
    });
    return { op, entity_type: 'task', entity_id: id };
  }

  if (op === 'create_project') {
    const name = normalizeTitleInput(command.name ?? command.title ?? '');
    if (!name) throw new Error(`Command ${index + 1}: create_project requires name`);
    const project = await createProjectRecord(name);
    if (!project) throw new Error(`Command ${index + 1}: create_project failed`);
    appendCrudEvent({
      source: 'automation',
      event: 'create_project',
      entity_type: 'project',
      entity_id: project.id,
      data: { name: project.name }
    });
    return { op, entity_type: 'project', entity_id: project.id, name: project.name };
  }

  if (op === 'update_project') {
    const id = command.id ?? command.project_id ?? null;
    if (!id) throw new Error(`Command ${index + 1}: update_project requires id`);
    const patch = (command.patch && typeof command.patch === 'object')
      ? { ...command.patch }
      : {};
    if (command.name !== undefined && patch.name === undefined) {
      patch.name = command.name;
    }
    const updated = await updateProjectRecord(id, patch);
    if (!updated) throw new Error(`Command ${index + 1}: update_project failed`);
    appendCrudEvent({
      source: 'automation',
      event: 'update_project',
      entity_type: 'project',
      entity_id: id,
      data: { fields: Object.keys(patch) }
    });
    return { op, entity_type: 'project', entity_id: id, updated_fields: Object.keys(patch) };
  }

  if (op === 'create_notice') {
    const title = normalizeTitleInput(command.title ?? command.name ?? '');
    if (!title) throw new Error(`Command ${index + 1}: create_notice requires title`);
    const notice = await createNoticeRecord({
      title,
      notify_at: normalizeAutomationDateInput(command.notify_at ?? command.scheduled_for) ?? nowIso(),
      notice_type: command.notice_type ?? command.type_key ?? 'general'
    });
    if (!notice) throw new Error(`Command ${index + 1}: create_notice failed`);
    appendCrudEvent({
      source: 'automation',
      event: 'create_notice',
      entity_type: 'notice',
      entity_id: notice.id,
      data: { title: notice.title }
    });
    return { op, entity_type: 'notice', entity_id: notice.id, title: notice.title };
  }

  if (op === 'create_shopping_list') {
    const name = normalizeTitleInput(command.name ?? command.title ?? '');
    if (!name) throw new Error(`Command ${index + 1}: create_shopping_list requires name`);
    const list = await createShoppingListRecord({
      name,
      store_name: command.store_name ?? null,
      event_date: command.event_date ?? null
    });
    if (!list) throw new Error(`Command ${index + 1}: create_shopping_list failed`);
    const items = Array.isArray(command.items)
      ? command.items.filter(Boolean).map(item => ({ name: String(item) }))
      : [];
    if (items.length) {
      await createShoppingItemsRecord(list.id, items);
    }
    appendCrudEvent({
      source: 'automation',
      event: 'create_shopping_list',
      entity_type: 'shopping_list',
      entity_id: list.id,
      data: { name: list.name, item_count: items.length }
    });
    return { op, entity_type: 'shopping_list', entity_id: list.id, name: list.name, item_count: items.length };
  }

  if (op === 'set_view') {
    const view = String(command.view ?? '').trim();
    if (!view) throw new Error(`Command ${index + 1}: set_view requires view`);
    setActiveView(view);
    return { op, view };
  }

  throw new Error(`Command ${index + 1}: unsupported op "${op}"`);
}

function getAutomationSyntaxGuideText() {
  return [
    'BrianHub Automation Console JSON syntax',
    '',
    'Accepted root formats:',
    '1) Single command object',
    '2) Array of command objects',
    '3) {"commands":[ ... ]}',
    '',
    'Command envelope:',
    '- Use "op" (or alias "action")',
    '- Commands run in sequence',
    '- Failed commands are reported, and later commands still run',
    '',
    'Supported ops:',
    '- create_task',
    '  Required: title (or name)',
    '  Optional: description_md, status, priority, project_id, parent_id, type_label, group_label, start_at, due_at, reminder_offset_days',
    '- update_task',
    '  Required: id (or task_id)',
    '  Optional direct fields: title, description_md, status, priority, project_id, parent_id, type_label, group_label, start_at, due_at, reminder_offset_days, recurrence_interval, recurrence_unit',
    '  Optional aliases: new_parent_id (reparent), patch { ... }',
    '- delete_task',
    '  Required: id (or task_id)',
    '- create_project',
    '  Required: name (or title)',
    '- update_project',
    '  Required: id (or project_id)',
    '  Optional: name, patch { ... }',
    '- create_notice',
    '  Required: title (or name)',
    '  Optional: notify_at (or scheduled_for), notice_type (or type_key)',
    '- create_shopping_list',
    '  Required: name (or title)',
    '  Optional: store_name, event_date, items (array of strings)',
    '- set_view',
    '  Required: view',
    '  Allowed views: tasks, scheduling, projects, shopping, notices, workflows, data-transfer, audit-log, automation, workspaces-manage, workspaces-archived',
    '',
    'Date/time inputs:',
    '- start_at, due_at, notify_at accept ISO datetime (example: 2026-03-01T14:30:00-08:00)',
    '- Date-only values (YYYY-MM-DD) are accepted and use current local time of day',
    '',
    'Example:',
    '```json',
    '{',
    '  "commands": [',
    '    { "op": "create_project", "name": "Client Work" },',
    '    { "op": "create_task", "title": "Call client", "priority": "high", "status": "inbox" },',
    '    { "op": "update_task", "id": "TASK_UUID", "due_at": "2026-03-02", "type_label": "Call" },',
    '    { "op": "create_notice", "title": "Send estimate", "notify_at": "2026-03-02T09:00:00-08:00" },',
    '    { "op": "set_view", "view": "tasks" }',
    '  ]',
    '}',
    '```'
  ].join('\n');
}

async function copyAutomationSyntaxGuide() {
  const guide = getAutomationSyntaxGuideText();
  await copyTextToClipboard(guide);
}

function setAutomationOutputText(value) {
  if (!automationOutput) return;
  automationOutput.value = value;
}

async function runAutomationCommandsFromInput() {
  if (!automationInput) return;
  const raw = automationInput.value.trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Automation input must be valid JSON.');
  }
  let commands;
  if (Array.isArray(parsed)) {
    commands = parsed;
  } else if (parsed && Array.isArray(parsed.commands)) {
    commands = parsed.commands;
  } else if (parsed && typeof parsed === 'object') {
    commands = [parsed];
  } else {
    throw new Error('Automation input must be a JSON object, an array, or { "commands": [...] }.');
  }
  if (!commands.length) {
    throw new Error('Automation command list is empty.');
  }

  const results = [];
  let hasSuccess = false;
  for (let i = 0; i < commands.length; i += 1) {
    try {
      const result = await runAutomationCommand(commands[i], i);
      results.push({ index: i, ok: true, result });
      hasSuccess = true;
    } catch (err) {
      results.push({ index: i, ok: false, error: err?.message ?? 'Unknown automation error' });
    }
  }

  setAutomationOutputText(JSON.stringify({
    ok: results.every(item => item.ok),
    command_count: commands.length,
    results
  }, null, 2));
  if (hasSuccess) {
    render();
  }
}

function getNoticeTypeLabel(key) {
  const types = (state.noticeTypes ?? []).length ? state.noticeTypes : DEFAULT_NOTICE_TYPES;
  return types.find(type => type.key === key)?.label ?? 'General';
}

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 980px)').matches;
}

function setMobileCreateSheetMode(mode = 'actions') {
  const taskMode = mode === 'task';
  if (mobileCreateSheetTitle) {
    mobileCreateSheetTitle.textContent = taskMode ? 'Quick task' : 'Create';
  }
  mobileCreateSheetActions?.classList.toggle('hidden', taskMode);
  mobileTaskQuickAddForm?.classList.toggle('hidden', !taskMode);
  if (!taskMode && mobileTaskQuickAddInput) {
    mobileTaskQuickAddInput.value = '';
  }
}

function openMobileCreateSheet({ mode = 'actions' } = {}) {
  if (!isMobileViewport() || !mobileCreateSheet) {
    openTaskModal();
    return;
  }
  closeMobileTopMenu();
  closeMobileTitleMenu();
  setMobileCreateSheetMode(mode);
  mobileCreateSheet.classList.remove('hidden');
  document.body.classList.add('mobile-create-open');
  if (mode === 'task') {
    requestAnimationFrame(() => {
      mobileTaskQuickAddInput?.focus();
    });
  }
}

function closeMobileCreateSheet() {
  if (mobileCreateSheet) {
    mobileCreateSheet.classList.add('hidden');
  }
  setMobileCreateSheetMode('actions');
  document.body.classList.remove('mobile-create-open');
}

function openMobileTaskQuickAdd() {
  setActiveView('tasks');
  clearActiveWorkflowChecklistInstanceId();
  render();
  openMobileCreateSheet({ mode: 'task' });
}

function closeMobileTopMenu() {
  if (!mobileTopMenu) return;
  mobileTopMenu.classList.add('hidden');
  if (openMenu === mobileTopMenu) {
    openMenu = null;
  }
}

function closeMobileTitleMenu() {
  if (!mobileTitleMenu) return;
  mobileTitleMenu.classList.add('hidden');
  appTitleTrigger?.setAttribute('aria-expanded', 'false');
  if (openMenu === mobileTitleMenu) {
    openMenu = null;
  }
}

function closeMobileSearchModal() {
  if (!mobileSearchModal) return;
  mobileSearchModal.classList.add('hidden');
  mobileSearchModal.setAttribute('aria-hidden', 'true');
}

function renderMobileSearchResults() {
  if (!mobileSearchResults) return;
  const query = getGlobalSearchQuery();
  mobileSearchResults.innerHTML = '';

  const scope = getGlobalSearchScope();
  const scopeLabels = {
    tasks: 'Tasks',
    projects: 'Projects',
    people: 'People',
    workflows: 'Workflows'
  };

  const scopesRow = document.createElement('div');
  scopesRow.className = 'global-search-scopes';
  Object.entries(scopeLabels).forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `global-search-scope-chip${scope === key ? ' is-active' : ''}`;
    button.dataset.scope = key;
    button.textContent = label;
    scopesRow.appendChild(button);
  });
  mobileSearchResults.appendChild(scopesRow);

  if (!query) {
    const empty = document.createElement('div');
    empty.className = 'global-search-empty';
    empty.textContent = 'Start typing to search.';
    mobileSearchResults.appendChild(empty);
    return;
  }

  const results = getGlobalSearchResults(query);
  const orderedScopes = [scope, ...['tasks', 'projects', 'people', 'workflows'].filter(item => item !== scope)];
  const resultsWrap = document.createElement('div');
  resultsWrap.className = 'global-search-results';
  let total = 0;
  orderedScopes.forEach((key) => {
    const rows = results[key] ?? [];
    if (!rows.length) return;
    total += rows.length;
    const section = document.createElement('div');
    section.className = 'global-search-section';
    const title = document.createElement('div');
    title.className = 'global-search-section-title';
    title.textContent = scopeLabels[key];
    section.appendChild(title);
    rows.slice(0, 8).forEach((row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'global-search-result';
      button.dataset.kind = row.kind;
      button.dataset.id = row.id;

      const resultTitle = document.createElement('span');
      resultTitle.className = 'global-search-result-title';
      resultTitle.textContent = row.title;

      const resultMeta = document.createElement('span');
      resultMeta.className = 'global-search-result-meta';
      resultMeta.textContent = row.meta;

      button.appendChild(resultTitle);
      button.appendChild(resultMeta);
      section.appendChild(button);
    });
    resultsWrap.appendChild(section);
  });

  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'global-search-empty';
    empty.textContent = 'No results found.';
    mobileSearchResults.appendChild(empty);
    return;
  }

  mobileSearchResults.appendChild(resultsWrap);
}

function openMobileSearchModal() {
  if (!mobileSearchModal) return;
  closeMobileTopMenu();
  closeMobileTitleMenu();
  closeMobileCreateSheet();
  closeMobileCalendarsModal();
  mobileSearchModal.classList.remove('hidden');
  mobileSearchModal.setAttribute('aria-hidden', 'false');
  if (mobileSearchInput) {
    mobileSearchInput.value = getGlobalSearchQuery();
    setTimeout(() => {
      mobileSearchInput?.focus();
      mobileSearchInput?.select();
    }, 0);
  }
  renderMobileSearchResults();
}

function openMobileSearchPrompt() {
  openMobileSearchModal();
}

function getScheduleCalendarEventCount(calendarId) {
  if (!state.workspace || !calendarId) return 0;
  return (state.scheduleEvents ?? [])
    .map(normalizeScheduleEvent)
    .filter((event) =>
      event.workspace_id === state.workspace.id
      && !event.archived
      && event.calendar_id === calendarId
    ).length;
}

function buildScheduleCalendarListItem(calendar, options = {}) {
  const compact = options.compact === true;
  const row = document.createElement('div');
  row.className = compact ? 'schedule-calendar-item is-compact' : 'schedule-calendar-item';

  const left = document.createElement('label');
  left.className = 'schedule-calendar-left';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'schedule-calendar-toggle';
  input.dataset.calendarId = calendar.id;
  input.checked = isSchedulingCalendarVisible(calendar.id);
  left.appendChild(input);

  const swatch = document.createElement('span');
  swatch.className = 'schedule-calendar-swatch';
  swatch.style.backgroundColor = normalizeScheduleCalendarColor(calendar.color);
  left.appendChild(swatch);

  const labelWrap = document.createElement('span');
  labelWrap.className = 'schedule-calendar-label-wrap';
  const name = document.createElement('span');
  name.className = 'schedule-calendar-name';
  name.textContent = calendar.name;
  labelWrap.appendChild(name);
  const meta = document.createElement('span');
  meta.className = 'schedule-calendar-meta';
  const count = getScheduleCalendarEventCount(calendar.id);
  const calendarTimeZone = normalizeTimeZone(calendar.time_zone ?? getSystemTimeZone());
  meta.textContent = `${count} event${count === 1 ? '' : 's'} · ${calendarTimeZone}`;
  labelWrap.appendChild(meta);
  left.appendChild(labelWrap);

  const actions = document.createElement('div');
  actions.className = 'schedule-calendar-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'subtle-button';
  editBtn.textContent = 'Edit';
  editBtn.dataset.calendarAction = 'edit';
  editBtn.dataset.calendarId = calendar.id;
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'subtle-button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.dataset.calendarAction = 'delete';
  deleteBtn.dataset.calendarId = calendar.id;
  actions.appendChild(deleteBtn);

  row.appendChild(left);
  row.appendChild(actions);
  return row;
}

function renderSchedulingCalendarList() {
  if (!schedulingCalendarList) return;
  const hasWorkspace = Boolean(state.workspace);
  if (schedulingCalendarAdd) schedulingCalendarAdd.disabled = !hasWorkspace;
  schedulingCalendarList.innerHTML = '';
  if (!hasWorkspace) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Select a workspace to manage calendars.';
    schedulingCalendarList.appendChild(note);
    return;
  }
  const calendars = getScheduleCalendarsForWorkspace();
  if (!calendars.length) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'No calendars yet.';
    schedulingCalendarList.appendChild(note);
    return;
  }
  calendars.forEach((calendar) => {
    schedulingCalendarList.appendChild(buildScheduleCalendarListItem(calendar));
  });
}

function renderMobileScheduleCalendarList() {
  if (!mobileCalendarList) return;
  const hasWorkspace = Boolean(state.workspace);
  if (mobileCalendarAdd) mobileCalendarAdd.disabled = !hasWorkspace;
  mobileCalendarList.innerHTML = '';
  if (!hasWorkspace) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Select a workspace to manage calendars.';
    mobileCalendarList.appendChild(note);
    return;
  }
  const calendars = getScheduleCalendarsForWorkspace();
  if (!calendars.length) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'No calendars yet.';
    mobileCalendarList.appendChild(note);
    return;
  }
  calendars.forEach((calendar) => {
    mobileCalendarList.appendChild(buildScheduleCalendarListItem(calendar, { compact: true }));
  });
}

function openScheduleCalendarCreatePrompt() {
  if (!state.workspace) return;
  const response = prompt('New calendar name');
  if (response === null) return;
  const defaultTimeZone = getSchedulingDisplayTimeZone();
  const timeZoneResponse = prompt('Calendar default time zone (IANA)', defaultTimeZone);
  if (timeZoneResponse === null) return;
  if (!String(timeZoneResponse).trim()) {
    alert('Calendar time zone is required.');
    return;
  }
  const normalizedTimeZone = normalizeTimeZone(timeZoneResponse, '');
  if (!normalizedTimeZone) {
    alert('Please enter a valid IANA time zone (example: America/Los_Angeles).');
    return;
  }
  const created = createScheduleCalendarRecord({ name: response, time_zone: normalizedTimeZone });
  if (!created) {
    alert('Calendar name is required.');
    return;
  }
  if (created.duplicate) {
    alert('A calendar with that name already exists.');
    return;
  }
  queueUserSettingsSave();
  render();
}

function openScheduleCalendarEditPrompt(calendarId) {
  const existing = getScheduleCalendarById(calendarId);
  if (!existing) return;
  const response = prompt('Calendar name', existing.name);
  if (response === null) return;
  const currentTimeZone = normalizeTimeZone(existing.time_zone ?? getSchedulingDisplayTimeZone());
  const timeZoneResponse = prompt('Calendar default time zone (IANA)', currentTimeZone);
  if (timeZoneResponse === null) return;
  if (!String(timeZoneResponse).trim()) {
    alert('Calendar time zone is required.');
    return;
  }
  const normalizedTimeZone = normalizeTimeZone(timeZoneResponse, '');
  if (!normalizedTimeZone) {
    alert('Please enter a valid IANA time zone (example: America/Los_Angeles).');
    return;
  }
  const updated = updateScheduleCalendarRecord(calendarId, {
    name: response,
    time_zone: normalizedTimeZone
  });
  if (!updated) {
    alert('Calendar name is required.');
    return;
  }
  if (updated.duplicate) {
    alert('A calendar with that name already exists.');
    return;
  }
  queueUserSettingsSave();
  render();
}

function deleteScheduleCalendarFromUi(calendarId) {
  const existing = getScheduleCalendarById(calendarId);
  if (!existing) return;
  const confirmed = confirm(`Delete calendar "${existing.name}"?`);
  if (!confirmed) return;
  const result = deleteScheduleCalendarRecord(calendarId);
  if (result?.error === 'last-calendar') {
    alert('At least one calendar is required.');
    return;
  }
  queueUserSettingsSave();
  render();
}

function syncMobileCalendarsModalInputs() {
  renderMobileScheduleCalendarList();
  const hasWorkspace = Boolean(state.workspace);
  if (mobileCalendarLayerEvent) {
    mobileCalendarLayerEvent.checked = isSchedulingKindVisible('event');
    mobileCalendarLayerEvent.disabled = !hasWorkspace;
  }
  if (mobileCalendarLayerTimeBlock) {
    mobileCalendarLayerTimeBlock.checked = isSchedulingKindVisible('time-block');
    mobileCalendarLayerTimeBlock.disabled = !hasWorkspace;
  }
  if (mobileCalendarLayerDayOff) {
    mobileCalendarLayerDayOff.checked = isSchedulingKindVisible('day-off');
    mobileCalendarLayerDayOff.disabled = !hasWorkspace;
  }
  if (mobileCalendarLayerTasks) {
    mobileCalendarLayerTasks.checked = getSchedulingShowTasks();
    mobileCalendarLayerTasks.disabled = !hasWorkspace;
  }
  if (mobileCalendarLayerHolidays) {
    mobileCalendarLayerHolidays.checked = getCalendarIncludeHolidays();
    mobileCalendarLayerHolidays.disabled = !hasWorkspace;
  }
}

function closeMobileCalendarsModal() {
  if (!mobileCalendarsModal) return;
  mobileCalendarsModal.classList.add('hidden');
  mobileCalendarsModal.setAttribute('aria-hidden', 'true');
}

function openMobileCalendarsModal() {
  if (!mobileCalendarsModal) return;
  closeMobileTopMenu();
  closeMobileTitleMenu();
  closeMobileCreateSheet();
  closeMobileSearchModal();
  syncMobileCalendarsModalInputs();
  mobileCalendarsModal.classList.remove('hidden');
  mobileCalendarsModal.setAttribute('aria-hidden', 'false');
}

function getViewLabel(view) {
  switch (view) {
    case 'scheduling':
      return 'Scheduling';
    case 'projects':
      return 'Projects';
    case 'shopping':
      return 'Shopping Lists';
    case 'notices':
      return 'Notices';
    case 'workflows':
      return 'Workflows';
    case 'help':
      return 'Help';
    case 'admin':
      return 'Admin';
    case 'profile':
      return 'Profile';
    case 'data-transfer':
      return 'Import / Export';
    case 'audit-log':
      return 'Audit Log';
    case 'automation':
      return 'Automation Console';
    case 'workspaces-manage':
      return 'Workspaces';
    case 'workspaces-archived':
      return 'Archived Workspaces';
    case 'tasks':
    default:
      return 'My Tasks';
  }
}

function getDefaultSettingsTab() {
  const activeView = getActiveView();
  if (activeView === 'scheduling') return 'scheduling';
  if (activeView === 'tasks') return 'tasks';
  if (activeView === 'crm') return 'crm';
  if (activeView === 'knowledge') return 'knowledge';
  return 'general';
}

function getSettingsTab() {
  const current = String(state.ui?.settingsTab ?? '').trim();
  if (SETTINGS_TAB_KEYS.has(current)) return current;
  return getDefaultSettingsTab();
}

function setSettingsTab(value) {
  state.ui = state.ui ?? {};
  const next = String(value ?? '').trim();
  state.ui.settingsTab = SETTINGS_TAB_KEYS.has(next) ? next : getDefaultSettingsTab();
}

function renderSettingsTabs() {
  if (!settingsTabButtons.length || !settingsTabPanels.length) return;
  const activeTab = getSettingsTab();
  settingsTabButtons.forEach((button) => {
    const tab = String(button.dataset.settingsTab ?? '');
    const active = tab === activeTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
  settingsTabPanels.forEach((panel) => {
    const tab = String(panel.dataset.settingsPanel ?? '');
    const active = tab === activeTab;
    panel.classList.toggle('is-active', active);
  });
}

function singularizeLabel(label) {
  const value = String(label ?? '').trim();
  if (!value) return '';
  const words = value.split(/\s+/);
  const lastIndex = words.length - 1;
  const lastWord = words[lastIndex];
  let singular = lastWord;
  if (/ies$/i.test(lastWord) && lastWord.length > 3) {
    singular = `${lastWord.slice(0, -3)}y`;
  } else if (/(ches|shes|xes|zes|ses)$/i.test(lastWord) && lastWord.length > 4) {
    singular = lastWord.replace(/es$/i, '');
  } else if (/s$/i.test(lastWord) && !/ss$/i.test(lastWord) && lastWord.length > 1) {
    singular = lastWord.slice(0, -1);
  }
  words[lastIndex] = singular;
  return words.join(' ');
}

function getWorkflowInstanceNoun(workflowName) {
  const singular = singularizeLabel(workflowName);
  return singular || 'Item';
}

function getMobileNavPrimaryConfig(activeView) {
  if (activeView === 'scheduling') {
    return {
      view: 'scheduling',
      label: 'Scheduling',
      title: 'Scheduling',
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2"></rect>
          <path d="M8 3.5v3M16 3.5v3M3.5 9.5h17"></path>
        </svg>
      `
    };
  }
  return {
    view: 'tasks',
    label: 'Tasks',
    title: 'My Tasks',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 7h12M6 12h9M6 17h7"></path>
        <circle cx="4" cy="7" r="1"></circle>
        <circle cx="4" cy="12" r="1"></circle>
        <circle cx="4" cy="17" r="1"></circle>
      </svg>
    `
  };
}

function setMobileNavButtonConfig(button, config) {
  if (!button) return;
  const hidden = Boolean(config?.hidden);
  button.classList.toggle('hidden', hidden);
  if (hidden) {
    button.classList.remove('is-active');
    button.removeAttribute('aria-current');
    return;
  }
  if (config?.view) {
    button.dataset.view = config.view;
  } else {
    delete button.dataset.view;
  }
  if (config?.action) {
    button.dataset.action = config.action;
  } else {
    delete button.dataset.action;
  }
  if (config?.title) {
    button.title = config.title;
  }
  const labelEl = button.querySelector('.mobile-nav-label');
  if (labelEl && typeof config?.label === 'string') {
    labelEl.textContent = config.label;
  }
  const iconEl = button.querySelector('.mobile-nav-icon');
  const iconKey = `${config?.view ?? 'action'}:${config?.action ?? ''}:${config?.label ?? ''}`;
  if (iconEl && typeof config?.icon === 'string' && iconEl.dataset.kind !== iconKey) {
    iconEl.innerHTML = config.icon.trim();
    iconEl.dataset.kind = iconKey;
  }
}

function syncMobileNavStandardButtons(activeView) {
  setMobileNavButtonConfig(mobileNavPrimary, getMobileNavPrimaryConfig(activeView));
  setMobileNavButtonConfig(mobileNavProjects, {
    view: 'projects',
    label: 'Projects',
    title: 'Projects',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h16M4 16h16"></path>
        <path d="M7 4v16"></path>
      </svg>
    `
  });
  setMobileNavButtonConfig(mobileNavShopping, {
    view: 'shopping',
    label: 'Shopping Lists',
    title: 'Shopping Lists',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h2l2 10h9l2-7H7"></path>
        <circle cx="10" cy="19" r="1.4"></circle>
        <circle cx="17" cy="19" r="1.4"></circle>
      </svg>
    `
  });
  setMobileNavButtonConfig(mobileNavWorkflows, {
    view: 'workflows',
    label: 'Workflow',
    title: 'Workflow Instances',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="7" height="7" rx="1.5"></rect>
        <rect x="13" y="4" width="7" height="7" rx="1.5"></rect>
        <rect x="4" y="13" width="7" height="7" rx="1.5"></rect>
        <rect x="13" y="13" width="7" height="7" rx="1.5"></rect>
      </svg>
    `
  });
}

function syncMobileNavSchedulingButtons() {
  setMobileNavButtonConfig(mobileNavPrimary, {
    view: 'scheduling',
    action: 'calendars',
    label: 'Calendars',
    title: 'Calendars',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="4" rx="1.2"></rect>
        <rect x="4" y="10" width="16" height="4" rx="1.2"></rect>
        <rect x="4" y="15" width="16" height="4" rx="1.2"></rect>
      </svg>
    `
  });
  setMobileNavButtonConfig(mobileNavProjects, {
    action: 'search',
    label: 'Search',
    title: 'Search',
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5"></circle>
        <path d="M16 16l4 4"></path>
      </svg>
    `
  });
  setMobileNavButtonConfig(mobileNavShopping, { hidden: true });
  setMobileNavButtonConfig(mobileNavWorkflows, { hidden: true });
}

function renderMobileNavigation() {
  if (!mobileNav) return;
  if (!isMobileViewport()) {
    closeMobileSearchModal();
    closeMobileCalendarsModal();
  }
  const activeView = getActiveView();
  const mobileSchedulingNav = isMobileViewport() && activeView === 'scheduling';
  if (mobileSchedulingNav) {
    syncMobileNavSchedulingButtons();
  } else {
    syncMobileNavStandardButtons(activeView);
  }
  mobileNav.classList.toggle('is-scheduling-module', mobileSchedulingNav);
  if (mobileNavAdd) {
    const taskQuickAdd = activeView === 'tasks';
    mobileNavAdd.title = taskQuickAdd ? 'Add task' : 'Create';
    mobileNavAdd.setAttribute('aria-label', taskQuickAdd ? 'Add task' : 'Create');
  }
  mobileNavButtons.forEach((button) => {
    const view = String(button.dataset.view ?? '').trim();
    const isHidden = button.classList.contains('hidden');
    const isActive = !isHidden && Boolean(view) && view === activeView;
    button.classList.toggle('is-active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
  if (appTitle) {
    appTitle.textContent = isMobileViewport() ? getViewLabel(activeView) : 'BrianHub';
  }
}

function shiftSchedulingMiniMonth(delta) {
  const monthDate = getSchedulingCalendarMonth();
  const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + Number(delta || 0), 1, 12, 0, 0, 0);
  setSchedulingCalendarMonth(nextMonth);
  const rangeMode = getSchedulingCalendarRange();
  if (rangeMode === 'week' || rangeMode === 'day') {
    const anchor = rangeMode === 'day' ? getSchedulingCalendarDay() : getSchedulingCalendarWeekStart();
    const maxDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const targetDay = Math.min(anchor.getDate(), maxDay);
    const targetDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), targetDay, 12, 0, 0, 0);
    if (rangeMode === 'week') {
      setSchedulingCalendarWeekStart(targetDate);
    } else {
      setSchedulingCalendarDay(targetDate);
    }
  }
  render();
}

function renderSchedulingMiniMonth(hasWorkspace) {
  if (!schedulingMiniMonthGrid || !schedulingMiniMonthTitle) return;
  schedulingMiniMonthGrid.innerHTML = '';
  if (schedulingMiniMonthPrev) {
    schedulingMiniMonthPrev.disabled = !hasWorkspace;
    schedulingMiniMonthPrev.onclick = hasWorkspace ? () => shiftSchedulingMiniMonth(-1) : null;
  }
  if (schedulingMiniMonthNext) {
    schedulingMiniMonthNext.disabled = !hasWorkspace;
    schedulingMiniMonthNext.onclick = hasWorkspace ? () => shiftSchedulingMiniMonth(1) : null;
  }
  if (!hasWorkspace) {
    schedulingMiniMonthTitle.textContent = 'No workspace';
    return;
  }

  const monthDate = getSchedulingCalendarMonth();
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  schedulingMiniMonthTitle.textContent = monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const startOffset = firstDay.getDay();
  const gridStart = new Date(year, monthIndex, 1 - startOffset, 12, 0, 0, 0);
  const todayKey = getDateIsoKey(new Date());
  const rangeMode = getSchedulingCalendarRange();
  const weekMode = getSchedulingWeekMode();
  const anchorDate = rangeMode === 'week'
    ? getSchedulingCalendarWeekStart()
    : rangeMode === 'day'
      ? getSchedulingCalendarDay()
      : monthDate;
  const anchorKey = getDateIsoKey(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), 12, 0, 0, 0));
  const weekVisibleKeys = new Set();
  if (rangeMode === 'week') {
    const anchor = getSchedulingCalendarWeekStart();
    const visibleDates = weekMode === 'workweek'
      ? Array.from({ length: 5 }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1 + index, 12, 0, 0, 0))
      : Array.from({ length: 7 }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + index, 12, 0, 0, 0));
    visibleDates.forEach((date) => {
      const key = getDateIsoKey(date);
      if (key) weekVisibleKeys.add(key);
    });
  }

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index, 12, 0, 0, 0);
    const key = getDateIsoKey(date);
    const dayButton = document.createElement('button');
    dayButton.type = 'button';
    dayButton.className = 'scheduling-mini-month-day';
    dayButton.textContent = String(date.getDate());
    dayButton.title = date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    dayButton.setAttribute('aria-label', dayButton.title);
    if (date.getMonth() !== monthIndex) dayButton.classList.add('is-outside');
    if (key && key === todayKey) dayButton.classList.add('is-today');
    if (key && key === anchorKey) dayButton.classList.add('is-selected');
    if (key && weekVisibleKeys.has(key)) dayButton.classList.add('is-in-range');
    dayButton.addEventListener('click', () => {
      setSchedulingCalendarMonth(date);
      if (getSchedulingCalendarRange() === 'week') {
        setSchedulingCalendarWeekStart(date);
      } else if (getSchedulingCalendarRange() === 'day') {
        setSchedulingCalendarDay(date);
      }
      render();
    });
    schedulingMiniMonthGrid.appendChild(dayButton);
  }
}

function renderSchedulingSidebar() {
  const hasWorkspace = Boolean(state.workspace);
  renderSchedulingCalendarList();
  if (schedulingLayerEvent) {
    schedulingLayerEvent.checked = isSchedulingKindVisible('event');
    schedulingLayerEvent.disabled = !hasWorkspace;
  }
  if (schedulingLayerTimeBlock) {
    schedulingLayerTimeBlock.checked = isSchedulingKindVisible('time-block');
    schedulingLayerTimeBlock.disabled = !hasWorkspace;
  }
  if (schedulingLayerDayOff) {
    schedulingLayerDayOff.checked = isSchedulingKindVisible('day-off');
    schedulingLayerDayOff.disabled = !hasWorkspace;
  }
  if (schedulingLayerTasks) {
    schedulingLayerTasks.checked = getSchedulingShowTasks();
    schedulingLayerTasks.disabled = !hasWorkspace;
  }
  if (schedulingLayerHolidays) {
    schedulingLayerHolidays.checked = getCalendarIncludeHolidays();
    schedulingLayerHolidays.disabled = !hasWorkspace;
  }
  renderSchedulingMiniMonth(hasWorkspace);
  if (schedulingSidebarAddEvent) schedulingSidebarAddEvent.disabled = !hasWorkspace;
  if (schedulingSidebarAddTimeBlock) schedulingSidebarAddTimeBlock.disabled = !hasWorkspace;
  if (schedulingSidebarAddDayOff) schedulingSidebarAddDayOff.disabled = !hasWorkspace;
}

function renderModuleNavigation() {
  const activeView = getActiveView();
  const schedulingActive = activeView === 'scheduling';
  if (tasksSidebarContent) {
    tasksSidebarContent.classList.toggle('hidden', schedulingActive);
  }
  if (schedulingSidebarContent) {
    schedulingSidebarContent.classList.toggle('hidden', !schedulingActive);
  }
  if (moduleNavTodo) {
    moduleNavTodo.classList.toggle('is-active', !schedulingActive);
    if (!schedulingActive) {
      moduleNavTodo.setAttribute('aria-current', 'page');
    } else {
      moduleNavTodo.removeAttribute('aria-current');
    }
  }
  if (moduleNavScheduling) {
    moduleNavScheduling.classList.toggle('is-active', schedulingActive);
    if (schedulingActive) {
      moduleNavScheduling.setAttribute('aria-current', 'page');
    } else {
      moduleNavScheduling.removeAttribute('aria-current');
    }
  }
}

function runMobileCreateAction(action) {
  if (action === 'task') {
    openMobileTaskQuickAdd();
    return;
  }
  if (action === 'notice') {
    setActiveView('notices');
    render();
    openNoticeModal();
    return;
  }
  if (action === 'shopping') {
    setActiveView('shopping');
    setMobileShoppingPanelMode('list');
    render();
    openShoppingListModal();
    return;
  }
  if (action === 'workflow') {
    setActiveView('workflows');
    setWorkflowViewMode('runs');
    setMobileWorkflowPanelMode('instances');
    setWorkflowInstanceFilter('open');
    let workflowId = getActiveWorkflowId();
    const usableWorkflows = getWorkflowsForWorkspace().filter(workflow => isWorkflowUsable(workflow.id));
    if (!workflowId || !usableWorkflows.some(workflow => workflow.id === workflowId)) {
      workflowId = usableWorkflows[0]?.id ?? null;
      setActiveWorkflowId(workflowId);
    }
    render();
    if (!workflowId) {
      alert('No runnable workflows yet. Use desktop to build or edit workflow blueprints.');
      return;
    }
    openWorkflowInstanceModal();
  }
}

function handleMobileQuickAdd() {
  if (getActiveView() === 'tasks') {
    runMobileCreateAction('task');
    return;
  }
  openMobileCreateSheet();
}

function normalizeNavigationView(view) {
  return NAVIGABLE_VIEWS.has(view) ? view : 'tasks';
}

function buildNavigationStateSnapshot() {
  return {
    version: NAVIGATION_STATE_VERSION,
    view: normalizeNavigationView(getActiveView()),
    workflowViewMode: getWorkflowViewMode() === 'manage' ? 'manage' : 'runs',
    workflowInstanceFilter: getWorkflowInstanceFilter() === 'completed' ? 'completed' : 'open',
    shoppingPageMode: getShoppingPageMode() === 'list' ? 'list' : 'details',
    mobileShoppingPanelMode: getMobileShoppingPanelMode() === 'details' ? 'details' : 'list',
    mobileWorkflowPanelMode: getMobileWorkflowPanelMode() === 'instances' ? 'instances' : 'list',
    activeProjectId: state.ui?.activeProjectId ?? null,
    activeShoppingListId: state.ui?.activeShoppingListId ?? null,
    activeWorkflowId: getActiveWorkflowId(),
    activeWorkflowChecklistInstanceId: getActiveWorkflowChecklistInstanceId()
  };
}

function getNavigationStateSignature(snapshot) {
  return [
    snapshot.version,
    snapshot.view,
    snapshot.workflowViewMode,
    snapshot.workflowInstanceFilter,
    snapshot.shoppingPageMode,
    snapshot.mobileShoppingPanelMode,
    snapshot.mobileWorkflowPanelMode,
    snapshot.activeProjectId ?? '',
    snapshot.activeShoppingListId ?? '',
    snapshot.activeWorkflowId ?? '',
    snapshot.activeWorkflowChecklistInstanceId ?? ''
  ].join('|');
}

function normalizeNavigationStateSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== NAVIGATION_STATE_VERSION) return null;
  const snapshot = {
    version: NAVIGATION_STATE_VERSION,
    view: normalizeNavigationView(raw.view),
    workflowViewMode: raw.workflowViewMode === 'manage' ? 'manage' : 'runs',
    workflowInstanceFilter: raw.workflowInstanceFilter === 'completed' ? 'completed' : 'open',
    shoppingPageMode: raw.shoppingPageMode === 'list' ? 'list' : 'details',
    mobileShoppingPanelMode: raw.mobileShoppingPanelMode === 'details' ? 'details' : 'list',
    mobileWorkflowPanelMode: raw.mobileWorkflowPanelMode === 'instances' ? 'instances' : 'list',
    activeProjectId: typeof raw.activeProjectId === 'string' && raw.activeProjectId ? raw.activeProjectId : null,
    activeShoppingListId: typeof raw.activeShoppingListId === 'string' && raw.activeShoppingListId ? raw.activeShoppingListId : null,
    activeWorkflowId: typeof raw.activeWorkflowId === 'string' && raw.activeWorkflowId ? raw.activeWorkflowId : null,
    activeWorkflowChecklistInstanceId: typeof raw.activeWorkflowChecklistInstanceId === 'string' && raw.activeWorkflowChecklistInstanceId
      ? raw.activeWorkflowChecklistInstanceId
      : null
  };
  const currentWorkspaceId = state.workspace?.id ?? null;
  if (
    snapshot.activeProjectId
    && snapshot.activeProjectId !== TASK_FILTER_UNASSIGNED
    && snapshot.activeProjectId !== TASK_FILTER_INBOX
    && !state.projects.some(project =>
      project.id === snapshot.activeProjectId && (!currentWorkspaceId || project.workspace_id === currentWorkspaceId)
    )
  ) {
    snapshot.activeProjectId = null;
  }
  if (snapshot.activeShoppingListId && !state.shoppingLists.some(list =>
    list.id === snapshot.activeShoppingListId && (!currentWorkspaceId || list.workspace_id === currentWorkspaceId)
  )) {
    snapshot.activeShoppingListId = null;
  }
  if (snapshot.activeWorkflowId && !state.workflows.some(workflow =>
    workflow.id === snapshot.activeWorkflowId && (!currentWorkspaceId || workflow.workspace_id === currentWorkspaceId)
  )) {
    snapshot.activeWorkflowId = null;
  }
  if (snapshot.activeWorkflowChecklistInstanceId && !state.workflowInstances.some(instance =>
    instance.id === snapshot.activeWorkflowChecklistInstanceId && (!currentWorkspaceId || instance.workspace_id === currentWorkspaceId)
  )) {
    snapshot.activeWorkflowChecklistInstanceId = null;
  }
  return snapshot;
}

function applyNavigationStateSnapshot(raw) {
  const snapshot = normalizeNavigationStateSnapshot(raw);
  if (!snapshot) return false;
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = snapshot.activeProjectId;
  state.ui.activeShoppingListId = snapshot.activeShoppingListId;
  setActiveWorkflowId(snapshot.activeWorkflowId);
  setActiveWorkflowChecklistInstanceId(snapshot.activeWorkflowChecklistInstanceId);
  setWorkflowViewMode(snapshot.workflowViewMode);
  setWorkflowInstanceFilter(snapshot.workflowInstanceFilter);
  setShoppingPageMode(snapshot.shoppingPageMode);
  setMobileShoppingPanelMode(snapshot.mobileShoppingPanelMode);
  setMobileWorkflowPanelMode(snapshot.mobileWorkflowPanelMode);
  setActiveView(snapshot.view);
  return true;
}

function syncNavigationHistory(options = {}) {
  if (typeof window === 'undefined' || !window.history || navigationHistoryApplying) return;
  const replace = Boolean(options.replace);
  const snapshot = buildNavigationStateSnapshot();
  const signature = getNavigationStateSignature(snapshot);
  if (!navigationHistoryReady || replace) {
    window.history.replaceState({ brianhubNav: snapshot }, '', window.location.href);
    navigationHistoryReady = true;
    navigationHistoryLastSignature = signature;
    return;
  }
  if (signature === navigationHistoryLastSignature) return;
  window.history.pushState({ brianhubNav: snapshot }, '', window.location.href);
  navigationHistoryLastSignature = signature;
}

function getActiveView() {
  return state.ui?.activeView ?? 'tasks';
}

function setActiveView(view) {
  const nextView = normalizeNavigationView(view);
  const previousView = getActiveView();
  if (previousView === 'shopping' && nextView !== 'shopping') {
    void maybeArchiveCompletedShoppingListOnExit();
  }
  state.ui = state.ui ?? {};
  state.ui.activeView = nextView;
  if (isMobileViewport()) {
    closeMobileTopMenu();
    closeMobileTitleMenu();
    closeMobileCreateSheet();
    closeMobileSearchModal();
    closeMobileCalendarsModal();
  }
}

function getTaskView() {
  return normalizeTaskView(state.ui?.taskView ?? 'list');
}

function setTaskView(view) {
  state.ui = state.ui ?? {};
  state.ui.taskView = normalizeTaskView(view);
}

function normalizeTaskView(view) {
  const value = String(view ?? '').trim().toLowerCase();
  if (value === 'kanban' || value === 'calendar' || value === 'smart') return value;
  return 'list';
}

function isWorkflowChecklistViewActive() {
  return Boolean(getActiveWorkflowChecklistInstanceId());
}

function normalizeTaskSortKey(key) {
  const value = String(key ?? '').trim().toLowerCase();
  if (value === 'due-asc' || value === 'due-desc') return value;
  return 'default';
}

function getTaskSortKey() {
  return normalizeTaskSortKey(state.ui?.taskSort ?? 'default');
}

function setTaskSortKey(key) {
  state.ui = state.ui ?? {};
  state.ui.taskSort = normalizeTaskSortKey(key);
}

function normalizeTaskGroupMode(mode) {
  if (mode === 'group') return 'section';
  if (['none', 'section', 'task-type', 'priority'].includes(mode)) return mode;
  return 'none';
}

function getTaskGroupMode() {
  return normalizeTaskGroupMode(state.ui?.taskGroupMode ?? 'none');
}

function setTaskGroupMode(mode) {
  state.ui = state.ui ?? {};
  state.ui.taskGroupMode = normalizeTaskGroupMode(mode);
}

function getTaskQuickAddVisible() {
  return state.ui?.showTaskQuickAdd !== false;
}

function setTaskQuickAddVisible(value) {
  state.ui = state.ui ?? {};
  state.ui.showTaskQuickAdd = Boolean(value);
}

function normalizeTaskCompletedVisibility(value) {
  return value === 'hide' ? 'hide' : 'show';
}

function getTaskCompletedVisibility() {
  return normalizeTaskCompletedVisibility(state.ui?.completedTaskVisibility);
}

function setTaskCompletedVisibility(value) {
  state.ui = state.ui ?? {};
  state.ui.completedTaskVisibility = normalizeTaskCompletedVisibility(value);
}

function normalizeTaskFutureVisibilityDays(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function getTaskFutureVisibilityDays() {
  return normalizeTaskFutureVisibilityDays(state.ui?.futureTaskVisibilityDays);
}

function setTaskFutureVisibilityDays(value) {
  state.ui = state.ui ?? {};
  state.ui.futureTaskVisibilityDays = normalizeTaskFutureVisibilityDays(value);
}

function getSchedulingShowTasks() {
  return Boolean(state.ui?.schedulingShowTasks);
}

function setSchedulingShowTasks(value) {
  state.ui = state.ui ?? {};
  state.ui.schedulingShowTasks = Boolean(value);
}

function normalizeSchedulingWeekMode(value) {
  return value === 'workweek' ? 'workweek' : 'seven';
}

function getSchedulingWeekMode() {
  return normalizeSchedulingWeekMode(state.ui?.schedulingWeekMode);
}

function setSchedulingWeekMode(value) {
  state.ui = state.ui ?? {};
  state.ui.schedulingWeekMode = normalizeSchedulingWeekMode(value);
}

function getSystemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function normalizeTimeZone(value, fallback = getSystemTimeZone()) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return String(fallback || 'UTC');
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    if (fallback === null || fallback === undefined || fallback === '') {
      return '';
    }
    return String(fallback || 'UTC');
  }
}

function getSchedulingDisplayTimeZone() {
  return normalizeTimeZone(state.ui?.schedulingTimeZone ?? getSystemTimeZone());
}

function setSchedulingDisplayTimeZone(value) {
  state.ui = state.ui ?? {};
  state.ui.schedulingTimeZone = normalizeTimeZone(value);
}

function normalizeSchedulingDefaultEventDurationMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SCHEDULE_EVENT_DURATION_MINUTES;
  return Math.min(
    MAX_SCHEDULE_EVENT_DURATION_MINUTES,
    Math.max(MIN_SCHEDULE_EVENT_DURATION_MINUTES, Math.floor(numeric))
  );
}

function getSchedulingDefaultEventDurationMinutes() {
  return normalizeSchedulingDefaultEventDurationMinutes(state.ui?.schedulingDefaultEventDurationMinutes);
}

function setSchedulingDefaultEventDurationMinutes(value) {
  state.ui = state.ui ?? {};
  state.ui.schedulingDefaultEventDurationMinutes = normalizeSchedulingDefaultEventDurationMinutes(value);
}

function normalizeSchedulingHiddenKinds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const hidden = [];
  value.forEach((entry) => {
    const kind = normalizeScheduleEventKind(entry);
    if (!SCHEDULING_EVENT_KINDS.includes(kind) || seen.has(kind)) return;
    seen.add(kind);
    hidden.push(kind);
  });
  return hidden;
}

function getSchedulingHiddenKinds() {
  return normalizeSchedulingHiddenKinds(state.ui?.schedulingHiddenKinds);
}

function isSchedulingKindVisible(kind) {
  const normalizedKind = normalizeScheduleEventKind(kind);
  return !getSchedulingHiddenKinds().includes(normalizedKind);
}

function setSchedulingKindVisible(kind, visible) {
  const normalizedKind = normalizeScheduleEventKind(kind);
  const hidden = new Set(getSchedulingHiddenKinds());
  if (visible) {
    hidden.delete(normalizedKind);
  } else {
    hidden.add(normalizedKind);
  }
  state.ui = state.ui ?? {};
  state.ui.schedulingHiddenKinds = normalizeSchedulingHiddenKinds(Array.from(hidden));
}

function normalizeSectionCompletedVisibility(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeTaskCompletedVisibility(value);
}

function normalizeSectionFutureVisibilityDays(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeTaskFutureVisibilityDays(value);
}

function isTaskCompletedAndHidden(task, completedVisibility) {
  return normalizeTaskCompletedVisibility(completedVisibility) === 'hide'
    && isDoneStatusKey(normalizeTaskStatusValue(task?.status));
}

function isTaskBeyondDueHorizon(task, futureVisibilityDays) {
  const horizonDays = normalizeTaskFutureVisibilityDays(futureVisibilityDays);
  if (horizonDays <= 0) return false;
  if (!task?.due_at) return false;
  const dueDate = new Date(task.due_at);
  if (Number.isNaN(dueDate.getTime())) return false;
  const threshold = Date.now() + (horizonDays * 24 * 60 * 60 * 1000);
  return dueDate.getTime() > threshold;
}

function normalizeSectionScopeProjectId(projectId) {
  return projectId ? String(projectId) : null;
}

function getActiveTaskSectionScopeProjectId() {
  return normalizeSectionScopeProjectId(getProjectIdFromTaskFilter());
}

function taskMatchesSectionScope(task, projectId) {
  return normalizeSectionScopeProjectId(task?.project_id) === normalizeSectionScopeProjectId(projectId);
}

function getSectionsForWorkspace() {
  if (!state.workspace) return [];
  const workspaceId = state.workspace.id;
  const projectId = getActiveTaskSectionScopeProjectId();
  const sections = (state.taskSections ?? [])
    .map(normalizeTaskSection)
    .filter(section =>
      section.workspace_id === workspaceId
      && normalizeSectionScopeProjectId(section.project_id) === projectId
    );
  const byLabel = new Map(sections.map(section => [section.label, section]));
  Object.values(state.tasks ?? {})
    .filter(task => task.workspace_id === workspaceId && taskMatchesSectionScope(task, projectId))
    .forEach(task => {
      const label = (task.group_label ?? '').trim();
      if (!label || byLabel.has(label)) return;
      byLabel.set(label, {
        id: `derived-${label}`,
        workspace_id: workspaceId,
        project_id: projectId,
        label,
        sort_order: null,
        completed_visibility: null,
        future_visibility_days: null
      });
    });

  const items = Array.from(byLabel.values());
  return items.sort((a, b) => {
    const aOrder = Number.isFinite(a.sort_order) ? a.sort_order : Number.POSITIVE_INFINITY;
    const bOrder = Number.isFinite(b.sort_order) ? b.sort_order : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.label.localeCompare(b.label);
  });
}

function isPersistedSection(section) {
  if (!section?.id) return false;
  return (state.taskSections ?? []).some(record => record.id === section.id);
}

function getTaskSectionRecordIndex(sectionInfo, sections = state.taskSections ?? []) {
  const workspaceId = state.workspace?.id ?? null;
  if (!workspaceId) return -1;
  const sourceLabel = String(sectionInfo?.label ?? '').trim();
  const sectionId = sectionInfo?.id ?? null;
  const scopeProjectId = normalizeSectionScopeProjectId(
    sectionInfo?.project_id ?? getActiveTaskSectionScopeProjectId()
  );
  let index = sections.findIndex((section) =>
    section.id === sectionId
    && section.workspace_id === workspaceId
    && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
  );
  if (index >= 0) return index;
  if (!sourceLabel) return -1;
  index = sections.findIndex((section) =>
    section.workspace_id === workspaceId
    && section.label === sourceLabel
    && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
  );
  return index;
}

function getTaskSectionCompletedVisibilityOverride(sectionInfo) {
  const sections = (state.taskSections ?? []).map(normalizeTaskSection);
  const index = getTaskSectionRecordIndex(sectionInfo, sections);
  if (index < 0) return null;
  return normalizeSectionCompletedVisibility(sections[index]?.completed_visibility);
}

function getTaskSectionCompletedVisibility(sectionInfo) {
  const override = getTaskSectionCompletedVisibilityOverride(sectionInfo);
  if (override) return override;
  return getTaskCompletedVisibility();
}

function getTaskSectionFutureVisibilityOverrideDays(sectionInfo) {
  const sections = (state.taskSections ?? []).map(normalizeTaskSection);
  const index = getTaskSectionRecordIndex(sectionInfo, sections);
  if (index < 0) return null;
  return normalizeSectionFutureVisibilityDays(sections[index]?.future_visibility_days);
}

function getTaskSectionFutureVisibilityDays(sectionInfo) {
  const override = getTaskSectionFutureVisibilityOverrideDays(sectionInfo);
  if (override === null) return getTaskFutureVisibilityDays();
  return override;
}

function setTaskSectionCompletedVisibilityOverride(sectionInfo, visibility) {
  const workspaceId = state.workspace?.id ?? null;
  if (!workspaceId) return;
  const label = String(sectionInfo?.label ?? '').trim();
  if (!label) return;
  const scopeProjectId = normalizeSectionScopeProjectId(
    sectionInfo?.project_id ?? getActiveTaskSectionScopeProjectId()
  );
  const sections = [...(state.taskSections ?? [])].map(normalizeTaskSection);
  let index = getTaskSectionRecordIndex(sectionInfo, sections);
  const nextVisibility = normalizeSectionCompletedVisibility(visibility);
  const timestamp = nowIso();

  if (index < 0) {
    const maxSort = Math.max(0, ...sections
      .filter(section =>
        section.workspace_id === workspaceId
        && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
      )
      .map(section => section.sort_order ?? 0));
    sections.push({
      id: createId(),
      workspace_id: workspaceId,
      project_id: scopeProjectId,
      label,
      sort_order: maxSort + 10,
      completed_visibility: nextVisibility,
      future_visibility_days: null,
      created_at: timestamp,
      updated_at: timestamp
    });
    state.taskSections = sections;
    persistLocalData();
    return;
  }

  const existing = sections[index];
  const currentVisibility = normalizeSectionCompletedVisibility(existing?.completed_visibility);
  if (currentVisibility === nextVisibility) return;
  sections[index] = {
    ...existing,
    completed_visibility: nextVisibility,
    updated_at: timestamp
  };
  state.taskSections = sections;
  persistLocalData();
}

function setTaskSectionFutureVisibilityOverrideDays(sectionInfo, days) {
  const workspaceId = state.workspace?.id ?? null;
  if (!workspaceId) return;
  const label = String(sectionInfo?.label ?? '').trim();
  if (!label) return;
  const scopeProjectId = normalizeSectionScopeProjectId(
    sectionInfo?.project_id ?? getActiveTaskSectionScopeProjectId()
  );
  const sections = [...(state.taskSections ?? [])].map(normalizeTaskSection);
  let index = getTaskSectionRecordIndex(sectionInfo, sections);
  const nextDays = normalizeSectionFutureVisibilityDays(days);
  const timestamp = nowIso();

  if (index < 0) {
    const maxSort = Math.max(0, ...sections
      .filter(section =>
        section.workspace_id === workspaceId
        && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
      )
      .map(section => section.sort_order ?? 0));
    sections.push({
      id: createId(),
      workspace_id: workspaceId,
      project_id: scopeProjectId,
      label,
      sort_order: maxSort + 10,
      completed_visibility: null,
      future_visibility_days: nextDays,
      created_at: timestamp,
      updated_at: timestamp
    });
    state.taskSections = sections;
    persistLocalData();
    return;
  }

  const existing = sections[index];
  const currentDays = normalizeSectionFutureVisibilityDays(existing?.future_visibility_days);
  if (currentDays === nextDays) return;
  sections[index] = {
    ...existing,
    future_visibility_days: nextDays,
    updated_at: timestamp
  };
  state.taskSections = sections;
  persistLocalData();
}

function createSectionRecord(label) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(label);
  if (!trimmed) return null;
  const workspaceId = state.workspace.id;
  const projectId = getActiveTaskSectionScopeProjectId();
  const existing = getSectionsForWorkspace().find(section =>
    section.label === trimmed
    && normalizeSectionScopeProjectId(section.project_id) === projectId
  );
  if (existing && existing.workspace_id === workspaceId && isPersistedSection(existing)) return existing;
  const now = new Date().toISOString();
  const maxSort = Math.max(0, ...((state.taskSections ?? [])
    .map(normalizeTaskSection)
    .filter(section =>
      section.workspace_id === workspaceId
      && normalizeSectionScopeProjectId(section.project_id) === projectId
    )
    .map(section => section.sort_order ?? 0)));
  const section = {
    id: createId(),
    workspace_id: workspaceId,
    project_id: projectId,
    label: trimmed,
    sort_order: maxSort + 10,
    completed_visibility: null,
    future_visibility_days: null,
    created_at: now,
    updated_at: now
  };
  state.taskSections = [...(state.taskSections ?? []), section];
  persistLocalData();
  return section;
}

function normalizeWorkflow(workflow) {
  return {
    ...workflow,
    description: workflow.description ?? '',
    archived: Boolean(workflow.archived)
  };
}

function normalizeWorkflowVariant(variant) {
  return {
    ...variant,
    description: variant.description ?? ''
  };
}

function normalizeWorkflowPhase(phase) {
  return {
    ...phase,
    description: phase.description ?? '',
    locked: Boolean(phase.locked)
  };
}

function normalizeWorkflowPhaseTask(task) {
  return {
    ...task,
    item_kind: task.item_kind === 'pattern' ? 'pattern' : 'task',
    pattern_id: task.pattern_id ?? null,
    if_applicable: Boolean(task.if_applicable),
    description_md: task.description_md ?? '',
    depends_on_ids: Array.isArray(task.depends_on_ids) ? task.depends_on_ids : [],
    assignee_user_id: task.assignee_user_id ?? null,
    assignee_label: task.assignee_label ?? null
  };
}

function normalizeWorkflowPattern(pattern) {
  return {
    ...pattern,
    description: pattern.description ?? '',
    if_applicable: Boolean(pattern.if_applicable),
    locked: Boolean(pattern.locked)
  };
}

function normalizeWorkflowPatternTask(task) {
  return {
    ...task,
    pattern_id: task.pattern_id ?? task.fragment_id ?? null,
    item_kind: task.item_kind === 'pattern' ? 'pattern' : 'task',
    referenced_pattern_id: task.referenced_pattern_id ?? null,
    if_applicable: Boolean(task.if_applicable),
    description_md: task.description_md ?? '',
    depends_on_ids: Array.isArray(task.depends_on_ids) ? task.depends_on_ids : [],
    assignee_user_id: task.assignee_user_id ?? null,
    assignee_label: task.assignee_label ?? null
  };
}

function normalizeWorkflowInstance(instance) {
  return {
    ...instance,
    notes: instance.notes ?? '',
    applicability_reviewed_at: instance.applicability_reviewed_at ?? null
  };
}

function normalizeWorkflowInstanceTaskLink(link) {
  return {
    ...link,
    dismissed_at: link.dismissed_at ?? null,
    if_applicable: Boolean(link.if_applicable)
  };
}

function getWorkflowsForWorkspace() {
  if (!state.workspace) return [];
  const workspaceId = state.workspace.id;
  return (state.workflows ?? [])
    .filter(workflow => workflow.workspace_id === workspaceId && !workflow.archived)
    .map(normalizeWorkflow)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getWorkflowById(id) {
  return (state.workflows ?? []).find(workflow => workflow.id === id) ?? null;
}

function isWorkflowUsable(workflowId) {
  const variants = getWorkflowVariants(workflowId);
  if (!variants.length) return false;
  for (const variant of variants) {
    const phases = getWorkflowVariantPhases(variant.id);
    for (const entry of phases) {
      const tasks = getWorkflowPhaseTasks(entry.phase.id);
      if (tasks.length) return true;
    }
  }
  return false;
}

function getWorkflowVariants(workflowId) {
  return (state.workflowVariants ?? [])
    .filter(variant => variant.workflow_id === workflowId)
    .map(normalizeWorkflowVariant)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function makeUniqueVariantName(workflowId, baseName) {
  const existing = new Set(getWorkflowVariants(workflowId).map(variant => variant.name.toLowerCase()));
  let name = baseName;
  let attempt = 1;
  while (existing.has(name.toLowerCase())) {
    name = `${baseName} (${attempt})`;
    attempt += 1;
  }
  return name;
}

function makeUniquePhaseName(workflowId, baseName) {
  const existing = new Set(getWorkflowPhases(workflowId).map(phase => phase.name.toLowerCase()));
  let name = baseName;
  let attempt = 1;
  while (existing.has(name.toLowerCase())) {
    name = `${baseName} (${attempt})`;
    attempt += 1;
  }
  return name;
}

function makeUniquePatternName(baseName) {
  const existing = new Set(getWorkflowPatternsForWorkspace().map(pattern => pattern.name.toLowerCase()));
  let name = baseName;
  let attempt = 1;
  while (existing.has(name.toLowerCase())) {
    name = `${baseName} (${attempt})`;
    attempt += 1;
  }
  return name;
}

function patternReferencesPattern(sourcePatternId, targetPatternId, visited = new Set()) {
  if (!sourcePatternId || !targetPatternId) return false;
  if (sourcePatternId === targetPatternId) return true;
  if (visited.has(sourcePatternId)) return false;
  visited.add(sourcePatternId);
  const entries = getWorkflowPatternTasks(sourcePatternId);
  for (const entry of entries) {
    if (entry.item_kind !== 'pattern' || !entry.referenced_pattern_id) continue;
    if (entry.referenced_pattern_id === targetPatternId) return true;
    if (patternReferencesPattern(entry.referenced_pattern_id, targetPatternId, visited)) return true;
  }
  return false;
}

function wouldCreatePatternCycle(parentPatternId, childPatternId) {
  if (!parentPatternId || !childPatternId) return false;
  if (parentPatternId === childPatternId) return true;
  return patternReferencesPattern(childPatternId, parentPatternId);
}

function getWorkflowPhases(workflowId) {
  return (state.workflowPhases ?? [])
    .filter(phase => phase.workflow_id === workflowId)
    .map(normalizeWorkflowPhase)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getWorkflowPhaseById(id) {
  const phase = (state.workflowPhases ?? []).find(item => item.id === id);
  return phase ? normalizeWorkflowPhase(phase) : null;
}

function isWorkflowPhaseLocked(phaseId) {
  return Boolean(getWorkflowPhaseById(phaseId)?.locked);
}

function getWorkflowVariantPhases(variantId) {
  const links = (state.workflowVariantPhases ?? [])
    .filter(link => link.variant_id === variantId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!links.length) return [];
  const phaseById = new Map((state.workflowPhases ?? []).map(phase => [phase.id, normalizeWorkflowPhase(phase)]));
  return links.map(link => ({
    ...link,
    phase: phaseById.get(link.phase_id)
  })).filter(entry => entry.phase);
}

function getWorkflowPhaseTasks(phaseId) {
  return (state.workflowPhaseTasks ?? [])
    .filter(task => task.phase_id === phaseId)
    .map(normalizeWorkflowPhaseTask)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getWorkflowPatternsForWorkspace() {
  if (!state.workspace) return [];
  const workspaceId = state.workspace.id;
  return (state.workflowPatterns ?? [])
    .filter(pattern => pattern.workspace_id === workspaceId)
    .map(normalizeWorkflowPattern)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getWorkflowPatternById(id) {
  return (state.workflowPatterns ?? []).find(pattern => pattern.id === id) ?? null;
}

function isWorkflowPatternLocked(patternId) {
  const pattern = getWorkflowPatternById(patternId);
  return Boolean(pattern?.locked);
}

function getWorkflowPatternTasks(patternId) {
  return (state.workflowPatternTasks ?? [])
    .map(normalizeWorkflowPatternTask)
    .filter(task => task.pattern_id === patternId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getWorkflowInstances(workflowId) {
  return (state.workflowInstances ?? [])
    .filter(instance => instance.workflow_id === workflowId)
    .map(normalizeWorkflowInstance)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function getWorkflowInstanceById(id) {
  const instance = (state.workflowInstances ?? []).find(item => item.id === id);
  return instance ? normalizeWorkflowInstance(instance) : null;
}

function getWorkflowInstanceTasks(instanceId) {
  return (state.workflowInstanceTasks ?? [])
    .filter(link => link.workflow_instance_id === instanceId)
    .map(normalizeWorkflowInstanceTaskLink);
}

function getWorkflowInstanceLinkByTaskId(taskId) {
  const link = (state.workflowInstanceTasks ?? []).find(item => item.task_id === taskId) ?? null;
  if (!link) return null;
  if (link.dismissed_at === undefined) link.dismissed_at = null;
  if (link.if_applicable === undefined) link.if_applicable = false;
  return link;
}

function isWorkflowTaskType(taskType) {
  return String(taskType ?? '').toLowerCase() === TASK_TYPE_WORKFLOW;
}

function isWorkflowTaskRecord(task, checklistInstanceId = null) {
  if (!task) return false;
  if (isWorkflowTaskType(task.task_type)) return true;
  return Boolean(getChecklistLinkForTask(task.id, checklistInstanceId));
}

function hasPendingWorkflowTaskTypeUpdate(taskId) {
  return (state.local?.pendingChanges ?? []).some(change =>
    change?.entity_type === 'task'
    && change?.entity_id === taskId
    && change?.action === 'update'
    && isWorkflowTaskType(change?.payload?.task_type)
  );
}

function normalizeWorkflowTitleKey(title) {
  return String(title ?? '').trim().toLowerCase();
}

function collectWorkflowTemplateTitleKeys() {
  const keys = new Set();
  (state.workflowPhaseTasks ?? []).forEach((entry) => {
    if (entry?.item_kind === 'pattern') return;
    const key = normalizeWorkflowTitleKey(entry?.title);
    if (key) keys.add(key);
  });
  (state.workflowPatternTasks ?? []).forEach((entry) => {
    if (entry?.item_kind === 'pattern') return;
    const key = normalizeWorkflowTitleKey(entry?.title);
    if (key) keys.add(key);
  });
  return keys;
}

function backfillWorkflowTaskTypeMarkers() {
  const workspaceId = state.workspace?.id ?? null;
  if (!workspaceId) return;
  const links = state.workflowInstanceTasks ?? [];
  const templateTitleKeys = collectWorkflowTemplateTitleKeys();
  const workspaceTasks = Object.values(state.tasks ?? {})
    .filter(task => task.workspace_id === workspaceId);
  const linkedTitleKeys = new Set();
  const templateTitleCounts = new Map();

  workspaceTasks.forEach((task) => {
    const key = normalizeWorkflowTitleKey(task.title);
    if (!key || !templateTitleKeys.has(key)) return;
    templateTitleCounts.set(key, (templateTitleCounts.get(key) ?? 0) + 1);
  });

  links.forEach((link) => {
    const task = state.tasks?.[link.task_id];
    if (!task) return;
    const key = normalizeWorkflowTitleKey(task.title);
    if (key) linkedTitleKeys.add(key);
  });

  const shouldMarkByTemplateSignature = (task) => {
    const key = normalizeWorkflowTitleKey(task?.title);
    if (!key || !templateTitleKeys.has(key)) return false;
    if (linkedTitleKeys.has(key)) return true;
    return (templateTitleCounts.get(key) ?? 0) > 1;
  };

  const workflowTaskIdSet = new Set(links.map(link => link.task_id).filter(Boolean));
  let changed = false;
  workspaceTasks.forEach((task) => {
    if (!task || isWorkflowTaskType(task.task_type)) return;
    if (!workflowTaskIdSet.has(task.id) && !shouldMarkByTemplateSignature(task)) return;
    state.tasks[task.id] = normalizeTask({
      ...task,
      task_type: TASK_TYPE_WORKFLOW,
      updated_at: nowIso()
    });
    if (!hasPendingWorkflowTaskTypeUpdate(task.id)) {
      queueLocalChange({
        entity_type: 'task',
        entity_id: task.id,
        action: 'update',
        payload: { task_type: TASK_TYPE_WORKFLOW }
      });
    }
    changed = true;
  });
  if (changed) persistLocalData();
}

function reconcileWorkflowWorkspaceIds() {
  const workspaceId = state.workspace?.id ?? null;
  if (!workspaceId) return;
  const knownWorkspaceIds = new Set((state.workspaces ?? []).map(item => item.id));
  const workflows = state.workflows ?? [];
  const patterns = state.workflowPatterns ?? [];
  let changed = false;

  workflows.forEach((workflow) => {
    if (!workflow?.workspace_id) return;
    if (knownWorkspaceIds.has(workflow.workspace_id)) return;
    workflow.workspace_id = workspaceId;
    workflow.updated_at = nowIso();
    changed = true;
  });

  patterns.forEach((pattern) => {
    if (!pattern?.workspace_id) return;
    if (knownWorkspaceIds.has(pattern.workspace_id)) return;
    pattern.workspace_id = workspaceId;
    pattern.updated_at = nowIso();
    changed = true;
  });

  if (!changed) return;
  state.workflows = [...workflows];
  state.workflowPatterns = [...patterns];
  persistLocalData();
}

function getWorkflowInstanceProgress(instanceId) {
  const links = getWorkflowInstanceTasks(instanceId);
  let done = 0;
  let dismissed = 0;
  links.forEach(link => {
    if (link.dismissed_at) {
      dismissed += 1;
      return;
    }
    const task = state.tasks?.[link.task_id];
    if (task && isDoneStatusKey(task.status)) {
      done += 1;
    }
  });
  const total = links.length;
  const resolved = done + dismissed;
  const isComplete = total > 0 && resolved >= total;
  return {
    total,
    done,
    dismissed,
    resolved,
    isComplete
  };
}

function dismissWorkflowTask(taskId) {
  const link = getWorkflowInstanceLinkByTaskId(taskId);
  if (!link || link.dismissed_at || !link.if_applicable) return;
  link.dismissed_at = nowIso();
  persistLocalData();
}

function restoreWorkflowTask(taskId) {
  const link = getWorkflowInstanceLinkByTaskId(taskId);
  if (!link || !link.dismissed_at) return;
  delete link.dismissed_at;
  persistLocalData();
}

function getWorkflowApplicabilityEntries(instanceId) {
  const links = getWorkflowInstanceTasks(instanceId)
    .filter(link => link.if_applicable || link.dismissed_at);
  if (!links.length) return [];
  const instance = (state.workflowInstances ?? []).find(item => item.id === instanceId) ?? null;
  const phaseNameById = new Map();
  if (instance?.variant_id) {
    getWorkflowVariantPhases(instance.variant_id).forEach(entry => {
      phaseNameById.set(entry.phase.id, entry.phase.name);
    });
  }
  return links
    .map(link => {
      const task = state.tasks?.[link.task_id] ?? null;
      if (!task) return null;
      return {
        link,
        task,
        phaseName: phaseNameById.get(link.phase_id) ?? 'Phase'
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.link.sort_order ?? 0) - (b.link.sort_order ?? 0));
}

function openWorkflowApplicabilityModal(instanceId) {
  if (!workflowApplicabilityModal || !workflowApplicabilityList) return;
  const instance = (state.workflowInstances ?? []).find(item => item.id === instanceId) ?? null;
  if (!instance) return;
  activeWorkflowApplicabilityInstanceId = instanceId;
  if (workflowApplicabilityTitle) {
    workflowApplicabilityTitle.textContent = `Optional tasks for ${instance.title}`;
  }
  if (workflowApplicabilitySubtitle) {
    workflowApplicabilitySubtitle.textContent = 'Choose which optional tasks should remain active for this workflow.';
  }
  workflowApplicabilityList.innerHTML = '';
  const entries = getWorkflowApplicabilityEntries(instanceId);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No optional tasks found for this workflow.';
    workflowApplicabilityList.appendChild(empty);
  } else {
    entries.forEach(entry => {
      const row = document.createElement('label');
      row.className = 'workflow-applicability-row';
      row.dataset.linkId = entry.link.id;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !entry.link.dismissed_at;
      const textWrap = document.createElement('div');
      textWrap.className = 'workflow-applicability-text';
      const title = document.createElement('div');
      title.className = 'workflow-applicability-title';
      title.textContent = entry.task.title;
      const meta = document.createElement('div');
      meta.className = 'workflow-applicability-meta';
      meta.textContent = entry.phaseName;
      textWrap.appendChild(title);
      textWrap.appendChild(meta);
      row.appendChild(checkbox);
      row.appendChild(textWrap);
      workflowApplicabilityList.appendChild(row);
    });
  }
  workflowApplicabilityModal.classList.remove('hidden');
}

function closeWorkflowApplicabilityModal() {
  workflowApplicabilityModal?.classList.add('hidden');
  activeWorkflowApplicabilityInstanceId = null;
}

function applyWorkflowApplicabilitySelections() {
  if (!activeWorkflowApplicabilityInstanceId || !workflowApplicabilityList) return;
  const links = state.workflowInstanceTasks ?? [];
  const now = nowIso();
  let changed = false;
  workflowApplicabilityList.querySelectorAll('.workflow-applicability-row').forEach((row) => {
    const linkId = row.dataset.linkId;
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!linkId || !checkbox) return;
    const link = links.find(item => item.id === linkId);
    if (!link) return;
    if (checkbox.checked) {
      if (link.dismissed_at) {
        delete link.dismissed_at;
        changed = true;
      }
      return;
    }
    if (!link.dismissed_at) {
      link.dismissed_at = now;
      changed = true;
    }
  });
  updateWorkflowInstanceRecord(activeWorkflowApplicabilityInstanceId, {
    applicability_reviewed_at: now
  });
  if (!changed) return;
  persistLocalData();
}

function setActiveWorkflowId(id) {
  state.ui = state.ui ?? {};
  state.ui.activeWorkflowId = id ?? null;
}

function getActiveWorkflowId() {
  return state.ui?.activeWorkflowId ?? null;
}

function setActiveWorkflowVariantId(id) {
  state.ui = state.ui ?? {};
  state.ui.activeWorkflowVariantId = id ?? null;
}

function getActiveWorkflowVariantId() {
  return state.ui?.activeWorkflowVariantId ?? null;
}

function getWorkflowInstanceFilter() {
  return state.ui?.workflowInstanceFilter ?? 'open';
}

function setWorkflowInstanceFilter(value) {
  state.ui = state.ui ?? {};
  state.ui.workflowInstanceFilter = value;
}

function getWorkflowViewMode() {
  return state.ui?.workflowViewMode ?? 'runs';
}

function setWorkflowViewMode(mode) {
  state.ui = state.ui ?? {};
  state.ui.workflowViewMode = mode;
}

function enterWorkflowManageView() {
  state.ui = state.ui ?? {};
  const alreadyManage = getActiveView() === 'workflows' && getWorkflowViewMode() === 'manage' && !isMobileViewport();
  if (!alreadyManage) {
    state.ui.workflowManageReturn = {
      view: getActiveView(),
      workflowViewMode: getWorkflowViewMode(),
      mobileWorkflowPanelMode: getMobileWorkflowPanelMode(),
      workflowInstanceFilter: getWorkflowInstanceFilter()
    };
  }
  setWorkflowViewMode(isMobileViewport() ? 'runs' : 'manage');
  if (isMobileViewport()) {
    setMobileWorkflowPanelMode('list');
  }
  setWorkflowInstanceFilter('open');
  setActiveView('workflows');
}

function exitWorkflowManageView() {
  const returnState = state.ui?.workflowManageReturn ?? null;
  state.ui = state.ui ?? {};
  state.ui.workflowManageReturn = null;
  if (!returnState) {
    setWorkflowViewMode('runs');
    setActiveView('tasks');
    return;
  }
  const nextView = returnState.view ?? 'tasks';
  if (nextView === 'workflows') {
    setActiveView('workflows');
    setWorkflowViewMode(returnState.workflowViewMode ?? 'runs');
    setWorkflowInstanceFilter(returnState.workflowInstanceFilter ?? 'open');
    if (isMobileViewport()) {
      setMobileWorkflowPanelMode(returnState.mobileWorkflowPanelMode ?? 'list');
    }
    return;
  }
  setActiveView(nextView);
}

function getActiveWorkflowChecklistInstanceId() {
  return state.ui?.activeWorkflowChecklistInstanceId ?? null;
}

function setActiveWorkflowChecklistInstanceId(id) {
  state.ui = state.ui ?? {};
  state.ui.activeWorkflowChecklistInstanceId = id ?? null;
}

function clearActiveWorkflowChecklistInstanceId() {
  setActiveWorkflowChecklistInstanceId(null);
}

function openWorkflowInstanceChecklist(instanceId) {
  const instance = getWorkflowInstanceById(instanceId);
  if (!instance) return;
  const links = getWorkflowInstanceTasks(instanceId).filter(link => !link.dismissed_at);
  if (!links.length) {
    alert('No active checklist tasks for this workflow.');
    return;
  }
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = null;
  setActiveWorkflowChecklistInstanceId(instanceId);
  setActiveView('tasks');
  render();
}

function getMobileShoppingPanelMode() {
  return state.ui?.mobileShoppingPanelMode === 'details' ? 'details' : 'list';
}

function setMobileShoppingPanelMode(mode) {
  state.ui = state.ui ?? {};
  state.ui.mobileShoppingPanelMode = mode === 'details' ? 'details' : 'list';
}

function getShoppingPageMode() {
  return state.ui?.shoppingPageMode === 'list' ? 'list' : 'details';
}

function setShoppingPageMode(mode) {
  state.ui = state.ui ?? {};
  state.ui.shoppingPageMode = mode === 'list' ? 'list' : 'details';
}

function getMobileWorkflowPanelMode() {
  return state.ui?.mobileWorkflowPanelMode === 'instances' ? 'instances' : 'list';
}

function setMobileWorkflowPanelMode(mode) {
  state.ui = state.ui ?? {};
  state.ui.mobileWorkflowPanelMode = mode === 'instances' ? 'instances' : 'list';
}

function getWorkflowPatternCollapsedMap() {
  state.ui = state.ui ?? {};
  state.ui.workflowPatternCollapsed = state.ui.workflowPatternCollapsed ?? {};
  return state.ui.workflowPatternCollapsed;
}

function isWorkflowPatternCollapsed(patternId) {
  const collapsedMap = getWorkflowPatternCollapsedMap();
  if (collapsedMap[patternId] === undefined) return true;
  return Boolean(collapsedMap[patternId]);
}

function setWorkflowPatternCollapsed(patternId, collapsed) {
  const collapsedMap = getWorkflowPatternCollapsedMap();
  collapsedMap[patternId] = Boolean(collapsed);
}

function getWorkflowPhaseCollapsedMap() {
  state.ui = state.ui ?? {};
  state.ui.workflowPhaseCollapsed = state.ui.workflowPhaseCollapsed ?? {};
  return state.ui.workflowPhaseCollapsed;
}

function isWorkflowPhaseCollapsed(phaseId) {
  const collapsedMap = getWorkflowPhaseCollapsedMap();
  if (collapsedMap[phaseId] === undefined) return true;
  return Boolean(collapsedMap[phaseId]);
}

function setWorkflowPhaseCollapsed(phaseId, collapsed) {
  const collapsedMap = getWorkflowPhaseCollapsedMap();
  collapsedMap[phaseId] = Boolean(collapsed);
}

function getNextWorkflowSortOrder(items) {
  return Math.max(0, ...items.map(item => item.sort_order ?? 0)) + 10;
}

function createWorkflowRecord({ name, description }) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const now = nowIso();
  const workflow = normalizeWorkflow({
    id: createId(),
    workspace_id: state.workspace.id,
    name: trimmed,
    description: description ?? '',
    archived: 0,
    created_at: now,
    updated_at: now
  });
  state.workflows = [...(state.workflows ?? []), workflow];
  persistLocalData();
  return workflow;
}

function updateWorkflowRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const workflows = state.workflows ?? [];
  const index = workflows.findIndex(item => item.id === id);
  if (index < 0) return null;
  const next = normalizeWorkflow({
    ...workflows[index],
    ...patch,
    updated_at: nowIso()
  });
  workflows[index] = next;
  state.workflows = workflows;
  persistLocalData();
  return next;
}

function deleteWorkflowRecord(id) {
  state.workflows = (state.workflows ?? []).filter(workflow => workflow.id !== id);
  const variantsToRemove = new Set((state.workflowVariants ?? [])
    .filter(variant => variant.workflow_id === id)
    .map(variant => variant.id));
  state.workflowVariants = (state.workflowVariants ?? [])
    .filter(variant => !variantsToRemove.has(variant.id));
  const phasesToRemove = new Set((state.workflowPhases ?? [])
    .filter(phase => phase.workflow_id === id)
    .map(phase => phase.id));
  state.workflowPhases = (state.workflowPhases ?? [])
    .filter(phase => !phasesToRemove.has(phase.id));
  state.workflowVariantPhases = (state.workflowVariantPhases ?? [])
    .filter(link => !variantsToRemove.has(link.variant_id) && !phasesToRemove.has(link.phase_id));
  state.workflowPhaseTasks = (state.workflowPhaseTasks ?? [])
    .filter(task => !phasesToRemove.has(task.phase_id));
  const instancesToRemove = new Set((state.workflowInstances ?? [])
    .filter(instance => instance.workflow_id === id)
    .map(instance => instance.id));
  state.workflowInstances = (state.workflowInstances ?? [])
    .filter(instance => !instancesToRemove.has(instance.id));
  state.workflowInstanceTasks = (state.workflowInstanceTasks ?? [])
    .filter(link => !instancesToRemove.has(link.workflow_instance_id));
  persistLocalData();
}

function createWorkflowVariantRecord(workflowId, name) {
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const variants = state.workflowVariants ?? [];
  const now = nowIso();
  const variant = normalizeWorkflowVariant({
    id: createId(),
    workflow_id: workflowId,
    name: trimmed,
    description: '',
    sort_order: getNextWorkflowSortOrder(variants.filter(item => item.workflow_id === workflowId)),
    created_at: now,
    updated_at: now
  });
  state.workflowVariants = [...variants, variant];
  persistLocalData();
  return variant;
}

function updateWorkflowVariantRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const variants = state.workflowVariants ?? [];
  const index = variants.findIndex(item => item.id === id);
  if (index < 0) return null;
  const next = normalizeWorkflowVariant({
    ...variants[index],
    ...patch,
    updated_at: nowIso()
  });
  variants[index] = next;
  state.workflowVariants = variants;
  persistLocalData();
  return next;
}

function deleteWorkflowVariantRecord(id) {
  state.workflowVariants = (state.workflowVariants ?? []).filter(variant => variant.id !== id);
  state.workflowVariantPhases = (state.workflowVariantPhases ?? [])
    .filter(link => link.variant_id !== id);
  const instancesToRemove = new Set((state.workflowInstances ?? [])
    .filter(instance => instance.variant_id === id)
    .map(instance => instance.id));
  state.workflowInstances = (state.workflowInstances ?? [])
    .filter(instance => !instancesToRemove.has(instance.id));
  state.workflowInstanceTasks = (state.workflowInstanceTasks ?? [])
    .filter(link => !instancesToRemove.has(link.workflow_instance_id));
  persistLocalData();
}

function createWorkflowPhaseRecord(workflowId, name) {
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const phases = state.workflowPhases ?? [];
  const now = nowIso();
  const phase = normalizeWorkflowPhase({
    id: createId(),
    workflow_id: workflowId,
    name: trimmed,
    description: '',
    locked: false,
    sort_order: getNextWorkflowSortOrder(phases.filter(item => item.workflow_id === workflowId)),
    created_at: now,
    updated_at: now
  });
  state.workflowPhases = [...phases, phase];
  persistLocalData();
  return phase;
}

function updateWorkflowPhaseRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  if (patch.locked !== undefined) {
    patch = { ...patch, locked: Boolean(patch.locked) };
  }
  const phases = state.workflowPhases ?? [];
  const index = phases.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = normalizeWorkflowPhase(phases[index]);
  if (current.locked) {
    const keys = Object.keys(patch);
    const lockToggleOnly = keys.length === 1 && keys[0] === 'locked';
    if (!lockToggleOnly) return current;
  }
  const next = normalizeWorkflowPhase({
    ...current,
    ...patch,
    updated_at: nowIso()
  });
  phases[index] = next;
  state.workflowPhases = phases;
  persistLocalData();
  return next;
}

function deleteWorkflowPhaseRecord(id) {
  state.workflowPhases = (state.workflowPhases ?? []).filter(phase => phase.id !== id);
  state.workflowVariantPhases = (state.workflowVariantPhases ?? [])
    .filter(link => link.phase_id !== id);
  state.workflowPhaseTasks = (state.workflowPhaseTasks ?? [])
    .filter(task => task.phase_id !== id);
  persistLocalData();
}

function duplicateWorkflowVariantRecord(variantId) {
  const variant = (state.workflowVariants ?? []).find(item => item.id === variantId);
  if (!variant) return null;
  const workflowId = variant.workflow_id;
  const name = makeUniqueVariantName(workflowId, `${variant.name} copy`);
  const nextVariant = createWorkflowVariantRecord(workflowId, name);
  if (!nextVariant) return null;
  const links = (state.workflowVariantPhases ?? [])
    .filter(link => link.variant_id === variantId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (links.length) {
    const nextLinks = state.workflowVariantPhases ?? [];
    const now = nowIso();
    const cloned = links.map(link => ({
      id: createId(),
      variant_id: nextVariant.id,
      phase_id: link.phase_id,
      sort_order: link.sort_order ?? 0,
      created_at: now,
      updated_at: now
    }));
    state.workflowVariantPhases = [...nextLinks, ...cloned];
    persistLocalData();
  }
  return nextVariant;
}

function copyWorkflowPhaseToBlueprint({ sourceWorkflowId, phaseId, targetWorkflowId, targetVariantId }) {
  const sourcePhase = getWorkflowPhases(sourceWorkflowId).find(phase => phase.id === phaseId);
  if (!sourcePhase) return null;
  const newPhaseName = makeUniquePhaseName(targetWorkflowId, `${sourcePhase.name} copy`);
  const newPhase = createWorkflowPhaseRecord(targetWorkflowId, newPhaseName);
  if (!newPhase) return null;
  linkWorkflowVariantPhase(targetVariantId, newPhase.id);
  const sourceTasks = getWorkflowPhaseTasks(sourcePhase.id)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const taskIdMap = new Map();
  sourceTasks.forEach(task => {
    const created = createWorkflowPhaseTaskRecord(newPhase.id, task.title, {
      item_kind: task.item_kind,
      pattern_id: task.pattern_id ?? null,
      if_applicable: Boolean(task.if_applicable),
      assignee_user_id: task.assignee_user_id ?? null,
      assignee_label: task.assignee_label ?? null
    });
    if (!created) return;
    taskIdMap.set(task.id, created.id);
    if (task.item_kind !== 'pattern' && task.description_md) {
      updateWorkflowPhaseTaskRecord(created.id, { description_md: task.description_md });
    }
  });
  sourceTasks.forEach(task => {
    if (task.item_kind === 'pattern') return;
    const newId = taskIdMap.get(task.id);
    if (!newId) return;
    const nextDeps = (task.depends_on_ids ?? [])
      .map(depId => taskIdMap.get(depId))
      .filter(Boolean);
    if (nextDeps.length) {
      updateWorkflowPhaseTaskRecord(newId, { depends_on_ids: nextDeps });
    }
  });
  return newPhase;
}

function linkWorkflowVariantPhase(variantId, phaseId) {
  const exists = (state.workflowVariantPhases ?? [])
    .some(link => link.variant_id === variantId && link.phase_id === phaseId);
  if (exists) return null;
  const links = state.workflowVariantPhases ?? [];
  const link = {
    id: createId(),
    variant_id: variantId,
    phase_id: phaseId,
    sort_order: getNextWorkflowSortOrder(links.filter(item => item.variant_id === variantId))
  };
  state.workflowVariantPhases = [...links, link];
  persistLocalData();
  return link;
}

function unlinkWorkflowVariantPhase(variantId, phaseId) {
  if (isWorkflowPhaseLocked(phaseId)) return;
  state.workflowVariantPhases = (state.workflowVariantPhases ?? [])
    .filter(link => !(link.variant_id === variantId && link.phase_id === phaseId));
  const stillUsed = (state.workflowVariantPhases ?? [])
    .some(link => link.phase_id === phaseId);
  if (!stillUsed) {
    deleteWorkflowPhaseRecord(phaseId);
  } else {
    persistLocalData();
  }
}

function createWorkflowPhaseTaskRecord(phaseId, title, options = {}) {
  if (isWorkflowPhaseLocked(phaseId)) return null;
  const trimmed = normalizeTitleInput(title);
  if (!trimmed) return null;
  const tasks = state.workflowPhaseTasks ?? [];
  const now = nowIso();
  const itemKind = options.item_kind === 'pattern' ? 'pattern' : 'task';
  const patternId = itemKind === 'pattern' ? (options.pattern_id ?? null) : null;
  const assigneeUserId = itemKind === 'pattern' ? null : (options.assignee_user_id ?? null);
  const assigneeLabel = itemKind === 'pattern' ? null : (options.assignee_label ? normalizeTitleInput(options.assignee_label) : null);
  const task = normalizeWorkflowPhaseTask({
    id: createId(),
    phase_id: phaseId,
    title: trimmed,
    item_kind: itemKind,
    pattern_id: patternId,
    if_applicable: Boolean(options.if_applicable),
    description_md: itemKind === 'pattern' ? '' : '',
    depends_on_ids: itemKind === 'pattern' ? [] : [],
    assignee_user_id: assigneeUserId,
    assignee_label: assigneeLabel,
    sort_order: getNextWorkflowSortOrder(tasks.filter(item => item.phase_id === phaseId)),
    created_at: now,
    updated_at: now
  });
  state.workflowPhaseTasks = [...tasks, task];
  persistLocalData();
  return task;
}

function updateWorkflowPhaseTaskRecord(id, patch) {
  if (patch.title !== undefined) {
    patch = { ...patch, title: normalizeTitleInput(patch.title) };
  }
  if (patch.item_kind !== undefined) {
    patch = {
      ...patch,
      item_kind: patch.item_kind === 'pattern' ? 'pattern' : 'task'
    };
  }
  if (patch.if_applicable !== undefined) {
    patch = {
      ...patch,
      if_applicable: Boolean(patch.if_applicable)
    };
  }
  if (patch.assignee_user_id !== undefined) {
    patch = {
      ...patch,
      assignee_user_id: patch.assignee_user_id || null
    };
  }
  if (patch.assignee_label !== undefined) {
    patch = {
      ...patch,
      assignee_label: patch.assignee_label ? normalizeTitleInput(patch.assignee_label) : null
    };
  }
  const tasks = state.workflowPhaseTasks ?? [];
  const index = tasks.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = normalizeWorkflowPhaseTask(tasks[index]);
  if (isWorkflowPhaseLocked(current.phase_id)) return current;
  const itemKind = patch.item_kind ?? current.item_kind;
  const normalizedPatch = { ...patch };
  if (itemKind === 'pattern') {
    if (normalizedPatch.pattern_id === undefined) {
      normalizedPatch.pattern_id = current.pattern_id ?? null;
    }
    normalizedPatch.description_md = '';
    normalizedPatch.depends_on_ids = [];
    normalizedPatch.if_applicable = false;
    normalizedPatch.assignee_user_id = null;
    normalizedPatch.assignee_label = null;
  } else if (normalizedPatch.pattern_id === undefined) {
    normalizedPatch.pattern_id = null;
  }
  if (itemKind !== 'pattern') {
    if ('assignee_user_id' in normalizedPatch && normalizedPatch.assignee_user_id) {
      normalizedPatch.assignee_label = null;
    } else if ('assignee_label' in normalizedPatch && normalizedPatch.assignee_label) {
      normalizedPatch.assignee_user_id = null;
    }
  }
  const next = normalizeWorkflowPhaseTask({
    ...tasks[index],
    ...normalizedPatch,
    updated_at: nowIso()
  });
  tasks[index] = next;
  state.workflowPhaseTasks = tasks;
  persistLocalData();
  return next;
}

function deleteWorkflowPhaseTaskRecord(id) {
  const task = (state.workflowPhaseTasks ?? [])
    .map(normalizeWorkflowPhaseTask)
    .find(item => item.id === id);
  if (task && isWorkflowPhaseLocked(task.phase_id)) return;
  state.workflowPhaseTasks = (state.workflowPhaseTasks ?? []).filter(task => task.id !== id);
  state.workflowPhaseTasks = (state.workflowPhaseTasks ?? []).map(task => {
    if (!Array.isArray(task.depends_on_ids)) return task;
    return {
      ...task,
      depends_on_ids: task.depends_on_ids.filter(dep => dep !== id)
    };
  });
  persistLocalData();
}

function createWorkflowPatternRecord(name, description = '') {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const now = nowIso();
  const pattern = normalizeWorkflowPattern({
    id: createId(),
    workspace_id: state.workspace.id,
    name: trimmed,
    description,
    if_applicable: false,
    locked: false,
    sort_order: getNextWorkflowSortOrder(getWorkflowPatternsForWorkspace()),
    created_at: now,
    updated_at: now
  });
  state.workflowPatterns = [...(state.workflowPatterns ?? []), pattern];
  persistLocalData();
  return pattern;
}

function updateWorkflowPatternRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  if (patch.if_applicable !== undefined) {
    patch = { ...patch, if_applicable: Boolean(patch.if_applicable) };
  }
  if (patch.locked !== undefined) {
    patch = { ...patch, locked: Boolean(patch.locked) };
  }
  const patterns = state.workflowPatterns ?? [];
  const index = patterns.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = normalizeWorkflowPattern(patterns[index]);
  if (current.locked) {
    const keys = Object.keys(patch);
    const lockToggleOnly = keys.length === 1 && keys[0] === 'locked';
    if (!lockToggleOnly) return current;
  }
  const next = normalizeWorkflowPattern({
    ...current,
    ...patch,
    updated_at: nowIso()
  });
  patterns[index] = next;
  state.workflowPatterns = patterns;
  persistLocalData();
  return next;
}

function deleteWorkflowPatternRecord(id) {
  if (isWorkflowPatternLocked(id)) return;
  const removedTaskIds = new Set(
    (state.workflowPatternTasks ?? [])
      .map(normalizeWorkflowPatternTask)
      .filter(task => task.pattern_id === id)
      .map(task => task.id)
  );
  state.workflowPatterns = (state.workflowPatterns ?? []).filter(pattern => pattern.id !== id);
  state.workflowPatternTasks = (state.workflowPatternTasks ?? [])
    .map(normalizeWorkflowPatternTask)
    .filter(task => task.pattern_id !== id)
    .map(task => {
      if (!Array.isArray(task.depends_on_ids)) return task;
      return {
        ...task,
        depends_on_ids: task.depends_on_ids.filter(dep => !removedTaskIds.has(dep))
      };
    });
  persistLocalData();
}

function createWorkflowPatternTaskRecord(patternId, title, options = {}) {
  if (isWorkflowPatternLocked(patternId)) return null;
  const trimmed = normalizeTitleInput(title);
  if (!trimmed) return null;
  const tasks = state.workflowPatternTasks ?? [];
  const now = nowIso();
  const itemKind = options.item_kind === 'pattern' ? 'pattern' : 'task';
  const referencedPatternId = itemKind === 'pattern' ? (options.referenced_pattern_id ?? null) : null;
  const assigneeUserId = itemKind === 'pattern' ? null : (options.assignee_user_id ?? null);
  const assigneeLabel = itemKind === 'pattern' ? null : (options.assignee_label ? normalizeTitleInput(options.assignee_label) : null);
  const patternTasks = tasks
    .map(normalizeWorkflowPatternTask)
    .filter(item => item.pattern_id === patternId);
  const task = normalizeWorkflowPatternTask({
    id: createId(),
    pattern_id: patternId,
    item_kind: itemKind,
    referenced_pattern_id: referencedPatternId,
    title: trimmed,
    if_applicable: Boolean(options.if_applicable),
    description_md: itemKind === 'pattern' ? '' : '',
    depends_on_ids: itemKind === 'pattern' ? [] : [],
    assignee_user_id: assigneeUserId,
    assignee_label: assigneeLabel,
    sort_order: getNextWorkflowSortOrder(patternTasks),
    created_at: now,
    updated_at: now
  });
  state.workflowPatternTasks = [...tasks, task];
  persistLocalData();
  return task;
}

function updateWorkflowPatternTaskRecord(id, patch) {
  if (patch.title !== undefined) {
    patch = { ...patch, title: normalizeTitleInput(patch.title) };
  }
  if (patch.item_kind !== undefined) {
    patch = {
      ...patch,
      item_kind: patch.item_kind === 'pattern' ? 'pattern' : 'task'
    };
  }
  if (patch.if_applicable !== undefined) {
    patch = {
      ...patch,
      if_applicable: Boolean(patch.if_applicable)
    };
  }
  if (patch.assignee_user_id !== undefined) {
    patch = {
      ...patch,
      assignee_user_id: patch.assignee_user_id || null
    };
  }
  if (patch.assignee_label !== undefined) {
    patch = {
      ...patch,
      assignee_label: patch.assignee_label ? normalizeTitleInput(patch.assignee_label) : null
    };
  }
  const tasks = state.workflowPatternTasks ?? [];
  const index = tasks.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = normalizeWorkflowPatternTask(tasks[index]);
  if (isWorkflowPatternLocked(current.pattern_id)) return current;
  const itemKind = patch.item_kind ?? current.item_kind;
  const normalizedPatch = { ...patch };
  if (itemKind === 'pattern') {
    if (normalizedPatch.referenced_pattern_id === undefined) {
      normalizedPatch.referenced_pattern_id = current.referenced_pattern_id ?? null;
    }
    normalizedPatch.description_md = '';
    normalizedPatch.depends_on_ids = [];
    normalizedPatch.if_applicable = false;
    normalizedPatch.assignee_user_id = null;
    normalizedPatch.assignee_label = null;
  } else if (normalizedPatch.referenced_pattern_id === undefined) {
    normalizedPatch.referenced_pattern_id = null;
  }
  if (itemKind !== 'pattern') {
    if ('assignee_user_id' in normalizedPatch && normalizedPatch.assignee_user_id) {
      normalizedPatch.assignee_label = null;
    } else if ('assignee_label' in normalizedPatch && normalizedPatch.assignee_label) {
      normalizedPatch.assignee_user_id = null;
    }
  }
  const next = normalizeWorkflowPatternTask({
    ...tasks[index],
    ...normalizedPatch,
    updated_at: nowIso()
  });
  tasks[index] = next;
  state.workflowPatternTasks = tasks;
  persistLocalData();
  return next;
}

function deleteWorkflowPatternTaskRecord(id) {
  const task = (state.workflowPatternTasks ?? [])
    .map(normalizeWorkflowPatternTask)
    .find(item => item.id === id);
  if (task && isWorkflowPatternLocked(task.pattern_id)) return;
  state.workflowPatternTasks = (state.workflowPatternTasks ?? []).filter(task => task.id !== id);
  state.workflowPatternTasks = (state.workflowPatternTasks ?? []).map(task => {
    if (!Array.isArray(task.depends_on_ids)) return task;
    return {
      ...task,
      depends_on_ids: task.depends_on_ids.filter(dep => dep !== id)
    };
  });
  persistLocalData();
}

function createPatternFromPhase(workflowId, phaseId, preferredName = null) {
  const phase = getWorkflowPhases(workflowId).find(item => item.id === phaseId);
  if (!phase) return null;
  const phaseTasks = getWorkflowPhaseTasks(phaseId);
  if (!phaseTasks.length) return null;
  const patternName = makeUniquePatternName(normalizeTitleInput(preferredName ?? phase.name));
  const pattern = createWorkflowPatternRecord(patternName);
  if (!pattern) return null;
  const idMap = new Map();
  phaseTasks.forEach(task => {
    const created = createWorkflowPatternTaskRecord(pattern.id, task.title, {
      item_kind: task.item_kind,
      referenced_pattern_id: task.pattern_id ?? null,
      if_applicable: Boolean(task.if_applicable),
      assignee_user_id: task.assignee_user_id ?? null,
      assignee_label: task.assignee_label ?? null
    });
    if (!created) return;
    idMap.set(task.id, created.id);
    if (task.item_kind !== 'pattern' && task.description_md) {
      updateWorkflowPatternTaskRecord(created.id, { description_md: task.description_md });
    }
  });
  phaseTasks.forEach(task => {
    if (task.item_kind === 'pattern') return;
    const nextTaskId = idMap.get(task.id);
    if (!nextTaskId) return;
    const deps = (task.depends_on_ids ?? [])
      .map(depId => idMap.get(depId))
      .filter(Boolean);
    if (deps.length) {
      updateWorkflowPatternTaskRecord(nextTaskId, { depends_on_ids: deps });
    }
  });
  return pattern;
}

function insertPatternIntoPhase({ phaseId, patternId }) {
  if (isWorkflowPhaseLocked(phaseId)) return null;
  const phase = (state.workflowPhases ?? []).find(item => item.id === phaseId);
  if (!phase) return null;
  const pattern = getWorkflowPatternById(patternId);
  if (!pattern) return null;
  const created = createWorkflowPhaseTaskRecord(phaseId, pattern.name, {
    item_kind: 'pattern',
    pattern_id: pattern.id
  });
  return created ? 1 : null;
}

function insertPatternIntoPattern({ targetPatternId, childPatternId }) {
  if (isWorkflowPatternLocked(targetPatternId)) return null;
  const targetPattern = getWorkflowPatternById(targetPatternId);
  if (!targetPattern) return null;
  const childPattern = getWorkflowPatternById(childPatternId);
  if (!childPattern) return null;
  if (wouldCreatePatternCycle(targetPatternId, childPatternId)) return null;
  const created = createWorkflowPatternTaskRecord(targetPatternId, childPattern.name, {
    item_kind: 'pattern',
    referenced_pattern_id: childPattern.id
  });
  return created ? 1 : null;
}

function createWorkflowInstanceRecord({ workflowId, variantId, title, notes }) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(title);
  if (!trimmed) return null;
  const now = nowIso();
  const instance = normalizeWorkflowInstance({
    id: createId(),
    workflow_id: workflowId,
    variant_id: variantId,
    workspace_id: state.workspace.id,
    title: trimmed,
    notes: notes ?? '',
    applicability_reviewed_at: null,
    created_at: now,
    updated_at: now
  });
  state.workflowInstances = [...(state.workflowInstances ?? []), instance];
  persistLocalData();
  return instance;
}

function updateWorkflowInstanceRecord(id, patch) {
  const instances = state.workflowInstances ?? [];
  const index = instances.findIndex(item => item.id === id);
  if (index < 0) return null;
  const next = normalizeWorkflowInstance({
    ...instances[index],
    ...patch,
    updated_at: nowIso()
  });
  instances[index] = next;
  state.workflowInstances = instances;
  persistLocalData();
  return next;
}

function deleteWorkflowInstanceRecord(id) {
  state.workflowInstances = (state.workflowInstances ?? []).filter(instance => instance.id !== id);
  state.workflowInstanceTasks = (state.workflowInstanceTasks ?? [])
    .filter(link => link.workflow_instance_id !== id);
  persistLocalData();
}

async function addTaskDependencyRecord(taskId, dependsOnId) {
  if (!taskId || !dependsOnId) return null;
  const existing = (state.taskDependencies ?? [])
    .some(dep => dep.task_id === taskId && dep.depends_on_id === dependsOnId);
  if (existing) return null;
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.addTaskDependency(taskId, dependsOnId);
      if (created) {
        state.taskDependencies = [...(state.taskDependencies ?? []), created];
        persistLocalData();
        return created;
      }
    } catch {
      // fall back to local
    }
  }
  const local = { task_id: taskId, depends_on_id: dependsOnId };
  state.taskDependencies = [...(state.taskDependencies ?? []), local];
  persistLocalData();
  return local;
}

async function scaffoldWorkflowInstance(instance, variantId) {
  const variantPhases = getWorkflowVariantPhases(variantId);
  if (!variantPhases.length) return;
  const taskMap = new Map();
  const links = [];
  const now = nowIso();

  const createInstanceTaskFromTemplate = async ({
    title,
    description_md,
    phaseId,
    templateTaskId,
    sortOrder,
    ifApplicable = false,
    assigneeUserId = null,
    assigneeLabel = null
  }) => {
    const created = await createTaskRecord({
      title,
      description_md: description_md ?? '',
      assignee_user_id: assigneeUserId ?? null,
      assignee_label: assigneeLabel ?? null,
      task_type: TASK_TYPE_WORKFLOW
    });
    if (!created) return null;
    links.push({
      id: createId(),
      workflow_instance_id: instance.id,
      task_id: created.id,
      phase_id: phaseId,
      template_task_id: templateTaskId,
      sort_order: sortOrder,
      created_at: now,
      dismissed_at: null,
      if_applicable: Boolean(ifApplicable)
    });
    return created.id;
  };

  const expandPatternEntries = async ({
    patternId,
    phaseId,
    templateTaskId,
    phaseSortCounter,
    inheritedIfApplicable = false,
    activeChain = new Set()
  }) => {
    if (!patternId) return;
    if (activeChain.has(patternId)) return;
    const nextChain = new Set(activeChain);
    nextChain.add(patternId);
    const pattern = getWorkflowPatternById(patternId);
    const patternIfApplicable = Boolean(inheritedIfApplicable) || Boolean(pattern?.if_applicable);
    const patternEntries = getWorkflowPatternTasks(patternId);
    if (!patternEntries.length) return;

    const localTaskMap = new Map();
    for (const entry of patternEntries) {
      if (entry.item_kind === 'pattern' && entry.referenced_pattern_id) {
        await expandPatternEntries({
          patternId: entry.referenced_pattern_id,
          phaseId,
          templateTaskId,
          phaseSortCounter,
          inheritedIfApplicable: patternIfApplicable || Boolean(entry.if_applicable),
          activeChain: nextChain
        });
        continue;
      }
      const createdTaskId = await createInstanceTaskFromTemplate({
        title: entry.title,
        description_md: entry.description_md ?? '',
        phaseId,
        templateTaskId,
        sortOrder: phaseSortCounter.next(),
        ifApplicable: patternIfApplicable || Boolean(entry.if_applicable),
        assigneeUserId: entry.assignee_user_id ?? null,
        assigneeLabel: entry.assignee_label ?? null
      });
      if (createdTaskId) {
        localTaskMap.set(entry.id, createdTaskId);
      }
    }

    for (const entry of patternEntries) {
      if (entry.item_kind === 'pattern') continue;
      if (!entry.depends_on_ids?.length) continue;
      const taskId = localTaskMap.get(entry.id);
      if (!taskId) continue;
      for (const dependsId of entry.depends_on_ids) {
        const dependsTaskId = localTaskMap.get(dependsId);
        if (!dependsTaskId) continue;
        await addTaskDependencyRecord(taskId, dependsTaskId);
      }
    }
  };

  for (let phaseIndex = 0; phaseIndex < variantPhases.length; phaseIndex += 1) {
    const phaseEntry = variantPhases[phaseIndex];
    const phaseTasks = getWorkflowPhaseTasks(phaseEntry.phase.id);
    let phaseSortOrdinal = 0;
    const phaseSortCounter = {
      next() {
        phaseSortOrdinal += 1;
        return (phaseIndex + 1) * 100000 + phaseSortOrdinal * 10;
      }
    };
    for (const templateEntry of phaseTasks) {
      if (templateEntry.item_kind === 'pattern' && templateEntry.pattern_id) {
        await expandPatternEntries({
          patternId: templateEntry.pattern_id,
          phaseId: phaseEntry.phase.id,
          templateTaskId: templateEntry.id,
          inheritedIfApplicable: Boolean(templateEntry.if_applicable),
          phaseSortCounter
        });
        continue;
      }
      const createdTaskId = await createInstanceTaskFromTemplate({
        title: templateEntry.title,
        description_md: templateEntry.description_md ?? '',
        phaseId: phaseEntry.phase.id,
        templateTaskId: templateEntry.id,
        sortOrder: phaseSortCounter.next(),
        ifApplicable: Boolean(templateEntry.if_applicable),
        assigneeUserId: templateEntry.assignee_user_id ?? null,
        assigneeLabel: templateEntry.assignee_label ?? null
      });
      if (!createdTaskId) continue;
      taskMap.set(templateEntry.id, createdTaskId);
    }
  }

  if (links.length) {
    state.workflowInstanceTasks = [...(state.workflowInstanceTasks ?? []), ...links];
    persistLocalData();
  }

  for (const phaseEntry of variantPhases) {
    const phaseTasks = getWorkflowPhaseTasks(phaseEntry.phase.id);
    for (const templateTask of phaseTasks) {
      if (templateTask.item_kind === 'pattern') continue;
      if (!templateTask.depends_on_ids?.length) continue;
      const taskId = taskMap.get(templateTask.id);
      if (!taskId) continue;
      for (const dependsId of templateTask.depends_on_ids) {
        const dependsTaskId = taskMap.get(dependsId);
        if (!dependsTaskId) continue;
        await addTaskDependencyRecord(taskId, dependsTaskId);
      }
    }
  }
}

async function deleteTaskSection(sectionInfo) {
  if (!state.workspace) return;
  const workspaceId = state.workspace.id;
  const trimmed = String(sectionInfo?.label ?? '').trim();
  if (!trimmed) return;
  const scopeProjectId = normalizeSectionScopeProjectId(sectionInfo?.project_id);
  const sections = state.taskSections ?? [];
  const updatedSections = sections.filter(section =>
    !(
      section.workspace_id === workspaceId
      && section.label === trimmed
      && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
    )
  );
  if (updatedSections.length !== sections.length) {
    state.taskSections = updatedSections;
    persistLocalData();
  }
  const tasks = Object.values(state.tasks ?? {});
  for (const task of tasks) {
    if (task.workspace_id !== workspaceId) continue;
    if (!taskMatchesSectionScope(task, scopeProjectId)) continue;
    const currentLabel = (task.group_label ?? '').trim();
    if (currentLabel !== trimmed) continue;
    await updateTaskRecord(task.id, { group_label: null });
  }
  render();
}

function getProjectFilterKey() {
  const key = state.ui?.projectFilter;
  return ['open', 'closed', 'all'].includes(key) ? key : 'open';
}

function setProjectFilterKey(key) {
  const next = ['open', 'closed', 'all'].includes(key) ? key : 'open';
  state.ui = state.ui ?? {};
  state.ui.projectFilter = next;
}

function getShoppingFilterKey() {
  const key = state.ui?.shoppingFilter;
  return ['open', 'closed', 'all'].includes(key) ? key : 'open';
}

function setShoppingFilterKey(key) {
  const next = ['open', 'closed', 'all'].includes(key) ? key : 'open';
  state.ui = state.ui ?? {};
  state.ui.shoppingFilter = next;
}

function getNoticeFilterKey() {
  const key = state.ui?.noticeFilter;
  return ['open', 'closed', 'all', 'upcoming', 'overdue', 'today'].includes(key) ? key : 'open';
}

function setNoticeFilterKey(key) {
  const next = ['open', 'closed', 'all', 'upcoming', 'overdue', 'today'].includes(key) ? key : 'open';
  state.ui = state.ui ?? {};
  state.ui.noticeFilter = next;
}

function getNoticeSortKey() {
  return state.ui?.noticeSort ?? 'time-asc';
}

function setNoticeSortKey(key) {
  state.ui = state.ui ?? {};
  state.ui.noticeSort = key;
}

function setKanbanQuickAdd(statusKey = null) {
  state.ui = state.ui ?? {};
  state.ui.kanbanQuickAdd = statusKey;
}

function getSyncBackoffMs(failureCount) {
  const index = Math.max(0, Math.min(SYNC_BACKOFF_STEPS_MS.length - 1, failureCount - 1));
  return SYNC_BACKOFF_STEPS_MS[index];
}

function formatSyncTime(value) {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'never';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function updateSyncOfflineNotice(forceOffline = null) {
  if (!syncOfflineNotice) return;
  const offline = forceOffline === null ? !navigator.onLine : Boolean(forceOffline);
  syncOfflineNotice.classList.toggle('hidden', !offline);
}

function resetSyncBackoff() {
  syncFailureCount = 0;
  syncCooldownUntil = 0;
}

function registerSyncFailure() {
  syncFailureCount = Math.min(syncFailureCount + 1, SYNC_BACKOFF_STEPS_MS.length);
  syncErrorCount = Math.max(0, syncErrorCount) + 1;
  const backoffMs = getSyncBackoffMs(syncFailureCount);
  syncCooldownUntil = Date.now() + backoffMs;
  if (syncStatus) {
    const seconds = Math.max(1, Math.ceil(backoffMs / 1000));
    syncStatus.textContent = `Sync error (${syncErrorCount}) · retry in ${seconds}s`;
  }
}

async function reloadWorkspacesAndData() {
  await loadWorkspaces();
  if (state.workspace) {
    await refreshWorkspace();
  } else {
    render();
  }
}

async function primeSyncCursor() {
  if (!state.workspace) return;
  if (hasPendingLocalChanges()) return;
  try {
    const cursor = state.ui?.syncCursor ?? 0;
    const result = await api.pullChanges(state.workspace.id, cursor);
    if (result?.next_cursor !== undefined) {
      state.ui = state.ui ?? {};
      state.ui.syncCursor = result.next_cursor;
    }
  } catch {
    // ignore sync init failures (offline is OK)
  }
}

async function autoRefreshOnChanges() {
  if (!state.workspace || syncInFlight) return;
  if (syncCooldownUntil && Date.now() < syncCooldownUntil) return;
  syncInFlight = true;
  try {
    updateSyncOfflineNotice();
    if (syncStatus) syncStatus.textContent = 'Syncing...';
    if (!navigator.onLine) {
      updateSyncOfflineNotice(true);
      if (syncStatus) syncStatus.textContent = `Offline · queued ${(state.local?.pendingChanges ?? []).length}`;
      return;
    }
    if (hasPendingLocalChanges()) {
      const pushResult = await pushPendingChanges();
      if (pushResult.error || pushResult.remaining.length) {
        const blocked = pushResult.remaining.find(change => change?.needs_attention);
        if (blocked) {
          if (syncStatus) syncStatus.textContent = 'Sync blocked · action required';
          if (blocked.client_mutation_id && blocked.client_mutation_id !== lastSyncAttentionMutationId) {
            lastSyncAttentionMutationId = blocked.client_mutation_id;
            const conflictEntity = blocked?.conflict?.entity_id
              ? ` (${blocked.conflict.entity_id})`
              : '';
            showToast({
              type: 'warn',
              message: blocked.last_error_code === 409
                ? `A queued change conflicted${conflictEntity}.`
                : 'A queued change needs attention.',
              details: blocked.last_error ?? 'Open tasks and resolve the conflicting change.'
            });
          }
        } else if (syncStatus) {
          syncStatus.textContent = `Queued ${(pushResult.remaining ?? []).length} · retry pending`;
        }
        registerSyncFailure();
        return;
      }
    }
    const cursor = state.ui?.syncCursor ?? 0;
    const result = await api.pullChanges(state.workspace.id, cursor);
    resetSyncBackoff();
    syncErrorCount = 0;
    syncLastSuccessAt = new Date().toISOString();
    lastSyncAttentionMutationId = null;
    if (result?.next_cursor !== undefined) {
      state.ui = state.ui ?? {};
      state.ui.syncCursor = result.next_cursor;
    }
    const clientId = getClientId();
    const changes = Array.isArray(result?.changes)
      ? result.changes.filter(change => change.client_id !== clientId)
      : [];
    if (changes.length) {
      const hasWorkspaceChange = changes.some(change => change.entity_type === 'workspace');
      if (hasWorkspaceChange) {
        await reloadWorkspacesAndData();
      } else {
        const snapshot = snapshotLocalData();
        const merged = applyRemoteChanges(snapshot, changes);
        if (merged.needsRefresh) {
          await refreshWorkspace();
        } else {
          applyLocalDataSnapshot(merged.data);
          persistLocalData();
          render();
        }
      }
    }
    if (syncStatus) {
      syncStatus.textContent = `Online · synced ${formatSyncTime(syncLastSuccessAt)} · errors ${syncErrorCount}`;
    }
    updateSyncOfflineNotice(false);
  } catch {
    registerSyncFailure();
    updateSyncOfflineNotice();
  } finally {
    syncInFlight = false;
  }
}

function getStatusDefinitions() {
  if (!state.workspace) return [];
  return (state.statuses ?? [])
    .filter(status => status.workspace_id === state.workspace.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getStatusByKey(key) {
  if (!key) return null;
  return getStatusDefinitions().find(status => status.key === key) ?? null;
}

function getStatusLabel(key) {
  if (!key) return '';
  return getStatusByKey(key)?.label ?? key;
}

function getStatusKind(key) {
  return getStatusByKey(key)?.kind ?? null;
}

function slugifyLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getNextStatusKey(label) {
  const base = slugifyLabel(label) || 'status';
  let key = base;
  let suffix = 2;
  const existingKeys = new Set(getStatusDefinitions().map(status => status.key));
  while (existingKeys.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

function getNextStatusSortOrder() {
  const maxSort = Math.max(0, ...(getStatusDefinitions().map(status => status.sort_order ?? 0)));
  return maxSort + 10;
}

function getStatusKeyByKind(kind) {
  return getStatusDefinitions().find(status => status.kind === kind)?.key ?? null;
}

function getDefaultStatusKey() {
  return (
    getStatusKeyByKind(TaskStatus.INBOX) ||
    getStatusKeyByKind(TaskStatus.PLANNED) ||
    getStatusDefinitions()[0]?.key ||
    TaskStatus.INBOX
  );
}

function getFallbackActiveStatusKey() {
  return (
    getStatusKeyByKind(TaskStatus.PLANNED) ||
    getStatusKeyByKind(TaskStatus.INBOX) ||
    getStatusDefinitions().find(status => ![TaskStatus.DONE, TaskStatus.CANCELED].includes(status.kind))?.key ||
    getDefaultStatusKey()
  );
}

function isDoneStatusKey(key) {
  return getStatusKind(key) === TaskStatus.DONE;
}

function isCanceledStatusKey(key) {
  return getStatusKind(key) === TaskStatus.CANCELED;
}

function isWaitingStatusKey(key) {
  return getStatusKind(key) === TaskStatus.WAITING;
}

function isInboxStatusKey(key) {
  return getStatusKind(key) === TaskStatus.INBOX;
}

function isPlannedStatusKey(key) {
  return getStatusKind(key) === TaskStatus.PLANNED;
}

function isInProgressStatusKey(key) {
  return getStatusKind(key) === TaskStatus.IN_PROGRESS;
}

function isBlockedStatusKey(key) {
  return getStatusKind(key) === TaskStatus.BLOCKED;
}

function requestInlineTaskEdit(taskId) {
  state.ui = state.ui ?? {};
  state.ui.inlineEditTaskId = taskId;
}

async function beginInlineTaskEdit(task, item, titleEl, { selectAll = true } = {}) {
  if (!task || !item || !titleEl) return;
  if (item.classList.contains('is-editing')) return;
  item.classList.add('is-editing');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-title-input';
  input.value = task.title ?? '';
  titleEl.replaceWith(input);
  input.focus();
  if (selectAll) {
    input.select();
  } else {
    input.setSelectionRange(input.value.length, input.value.length);
  }

  const finish = async (apply) => {
    if (!item.classList.contains('is-editing')) return;
    item.classList.remove('is-editing');
    const nextTitle = input.value.trim();
    if (apply) {
      if (nextTitle !== (task.title ?? '')) {
        await updateTaskRecord(task.id, { title: nextTitle });
      }
    }
    render();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => {
    finish(true);
  });
}

function stringToHue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function toCssToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'default';
}

const STATUS_COLOR_MAP = {
  [TaskStatus.INBOX]: '#3fa6ff',
  [TaskStatus.PLANNED]: '#38d9a9',
  [TaskStatus.IN_PROGRESS]: '#ffd166',
  [TaskStatus.WAITING]: '#a78bfa',
  [TaskStatus.BLOCKED]: '#ff6b6b',
  [TaskStatus.DONE]: '#51cf66',
  [TaskStatus.CANCELED]: '#868e96'
};

function getStatusColor(key) {
  if (!key) return '#4b5568';
  return STATUS_COLOR_MAP[key] ?? `hsl(${stringToHue(key)}, 60%, 55%)`;
}

const RECURRENCE_UNITS = new Set(['day', 'week', 'month', 'year']);
const WEEKDAY_PRESET_DAYS = [1, 2, 3, 4, 5];

function addInterval(date, interval, unit) {
  const next = new Date(date.getTime());
  if (unit === 'day') next.setDate(next.getDate() + interval);
  if (unit === 'week') next.setDate(next.getDate() + interval * 7);
  if (unit === 'month') next.setMonth(next.getMonth() + interval);
  if (unit === 'year') next.setFullYear(next.getFullYear() + interval);
  return next;
}

function normalizeRecurrenceUnit(unit) {
  return RECURRENCE_UNITS.has(unit) ? unit : 'month';
}

function toLocalDateValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toLocalTimeValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

function combineDateAndTimeToIso(dateValue, timeValue, fallbackTimeIso = null) {
  if (!dateValue) return null;
  let hour = 0;
  let minute = 0;
  if (timeValue) {
    const [h, m] = timeValue.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    hour = h;
    minute = m;
  } else if (fallbackTimeIso) {
    const fallback = new Date(fallbackTimeIso);
    if (!Number.isNaN(fallback.getTime())) {
      hour = fallback.getHours();
      minute = fallback.getMinutes();
    }
  }
  const [year, month, day] = dateValue.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate.toISOString();
}

function normalizeWeekdays(days = []) {
  return [...new Set((days ?? [])
    .map(Number)
    .filter(Number.isFinite)
    .filter(day => day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

function sanitizeNoticeRecurrenceRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const interval = Number(rule.interval);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  const unit = normalizeRecurrenceUnit(rule.unit);
  const endType = ['never', 'on', 'after'].includes(rule.endType) ? rule.endType : 'never';
  const endDate = endType === 'on' ? (rule.endDate ?? null) : null;
  const endCountValue = Number(rule.endCount);
  const endCount = endType === 'after' && Number.isFinite(endCountValue) && endCountValue > 0
    ? Math.floor(endCountValue)
    : null;
  const weekdays = unit === 'week' ? normalizeWeekdays(rule.weekdays) : [];
  const anchorDate = (() => {
    if (!rule.anchorDate) return null;
    const value = new Date(rule.anchorDate);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  })();
  return {
    interval: Math.floor(interval),
    unit,
    weekdays,
    endType,
    endDate,
    endCount,
    anchorDate
  };
}

function getNoticeRecurrenceRule(notice) {
  if (notice?.recurrence_rule && typeof notice.recurrence_rule === 'object') {
    return sanitizeNoticeRecurrenceRule(notice.recurrence_rule);
  }
  const legacyInterval = Number(notice?.recurrence_interval);
  if (Number.isFinite(legacyInterval) && legacyInterval > 0 && notice?.recurrence_unit) {
    return sanitizeNoticeRecurrenceRule({
      interval: legacyInterval,
      unit: notice.recurrence_unit,
      endType: 'never'
    });
  }
  return null;
}

function isBirthdayNoticeType(typeKey) {
  return String(typeKey ?? '').trim().toLowerCase() === NOTICE_TYPE_BIRTHDAY;
}

function getNoticeRepeatPresetFromRule(rule, notifyAtIso) {
  if (!rule) return 'none';
  const weekdays = normalizeWeekdays(rule.weekdays);
  if (rule.interval === 1 && rule.unit === 'day' && !weekdays.length && rule.endType === 'never') return 'daily';
  if (rule.interval === 1 && rule.unit === 'month' && !weekdays.length && rule.endType === 'never') return 'monthly';
  if (rule.interval === 1 && rule.unit === 'year' && !weekdays.length && rule.endType === 'never') return 'yearly';
  if (rule.interval === 1 && rule.unit === 'week' && JSON.stringify(weekdays) === JSON.stringify(WEEKDAY_PRESET_DAYS) && rule.endType === 'never') {
    return 'weekday';
  }
  if (rule.interval === 1 && rule.unit === 'week' && weekdays.length === 1 && rule.endType === 'never') {
    const notifyDate = notifyAtIso ? new Date(notifyAtIso) : null;
    if (notifyDate && !Number.isNaN(notifyDate.getTime()) && weekdays[0] === notifyDate.getDay()) {
      return 'weekly';
    }
  }
  return 'custom';
}

function buildNoticeRecurrenceRuleFromPreset(preset, notifyAtIso) {
  if (preset === 'none') return null;
  if (preset === 'custom') {
    const rule = sanitizeNoticeRecurrenceRule(noticeRecurrenceDraft);
    if (!rule) return null;
    return { ...rule, anchorDate: noticeRecurrenceDraft?.anchorDate ?? notifyAtIso ?? null };
  }
  if (preset === 'daily') return { interval: 1, unit: 'day', weekdays: [], endType: 'never', endDate: null, endCount: null, anchorDate: notifyAtIso ?? null };
  if (preset === 'monthly') return { interval: 1, unit: 'month', weekdays: [], endType: 'never', endDate: null, endCount: null, anchorDate: notifyAtIso ?? null };
  if (preset === 'yearly') return { interval: 1, unit: 'year', weekdays: [], endType: 'never', endDate: null, endCount: null, anchorDate: notifyAtIso ?? null };
  if (preset === 'weekday') return { interval: 1, unit: 'week', weekdays: [...WEEKDAY_PRESET_DAYS], endType: 'never', endDate: null, endCount: null, anchorDate: notifyAtIso ?? null };
  if (preset === 'weekly') {
    const weekday = (() => {
      const date = notifyAtIso ? new Date(notifyAtIso) : new Date();
      return Number.isNaN(date.getTime()) ? new Date().getDay() : date.getDay();
    })();
    return { interval: 1, unit: 'week', weekdays: [weekday], endType: 'never', endDate: null, endCount: null, anchorDate: notifyAtIso ?? null };
  }
  return null;
}

function ruleToLegacyRecurrence(rule) {
  if (!rule) return { interval: null, unit: null };
  return {
    interval: rule.interval ?? null,
    unit: rule.unit ?? null
  };
}

function formatNoticeRecurrence(rule) {
  if (!rule) return '';
  const unitLabel = `${rule.unit}${rule.interval > 1 ? 's' : ''}`;
  if (rule.unit === 'week' && normalizeWeekdays(rule.weekdays).length === 5 && JSON.stringify(normalizeWeekdays(rule.weekdays)) === JSON.stringify(WEEKDAY_PRESET_DAYS)) {
    return 'every weekday';
  }
  return `every ${rule.interval} ${unitLabel}`;
}

function formatNoticeDateTimeDisplay(iso) {
  if (!iso) return 'No date set';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function populateNoticeReadonlyView(notice) {
  if (!notice) return;
  if (noticeReadonlyTitle) noticeReadonlyTitle.textContent = notice.title ?? '';
  if (noticeReadonlyType) noticeReadonlyType.textContent = getNoticeTypeLabel(notice.notice_type);
  if (noticeReadonlyDatetime) noticeReadonlyDatetime.textContent = formatNoticeDateTimeDisplay(notice.notify_at);
  if (noticeReadonlyRepeat) {
    const recurrenceLabel = formatNoticeRecurrence(getNoticeRecurrenceRule(notice));
    noticeReadonlyRepeat.textContent = recurrenceLabel ? recurrenceLabel : 'Does not repeat';
  }
}

function setNoticeModalMode(mode, notice = null) {
  const nextMode = mode === 'view' || mode === 'edit' ? mode : 'create';
  noticeModalMode = nextMode;
  const isView = nextMode === 'view';
  const hasNotice = Boolean(notice?.id);
  noticeReadonly?.classList.toggle('hidden', !isView);
  noticeFormFields?.classList.toggle('hidden', isView);
  if (noticeModalTitle) {
    noticeModalTitle.textContent = nextMode === 'create' ? 'New Notice' : (isView ? 'Notice' : 'Edit Notice');
  }
  if (noticeSaveBtn) {
    noticeSaveBtn.textContent = nextMode === 'create' ? 'Create' : (isView ? '✎ Edit' : 'Save');
  }
  if (noticeCancel) {
    noticeCancel.textContent = isView ? 'Close' : 'Cancel';
  }
  noticeDismissBtn?.classList.toggle('hidden', !hasNotice);
}

function getProjectName(projectId) {
  if (!projectId) return null;
  const project = (state.projects ?? []).find(item => item.id === projectId);
  return project?.name ?? null;
}

function formatRecurrence(interval, unit) {
  if (!interval) return 'No repeat';
  const count = Number(interval);
  if (!count || !unit) return 'No repeat';
  return `Repeats every ${count} ${unit}${count > 1 ? 's' : ''}`;
}

function formatTaskDueMeta(dueAt) {
  if (!dueAt) return 'No due';
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return 'No due';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTaskRepeatMeta(interval, unit) {
  if (!interval || !unit) return 'No repeat';
  const count = Number(interval);
  if (!Number.isFinite(count) || count <= 0) return 'No repeat';
  return `Every ${count} ${unit}${count > 1 ? 's' : ''}`;
}

function getRecurrenceState(context) {
  return context === 'editor' ? editorRecurrence : modalRecurrence;
}

function setRecurrenceState(context, interval, unit) {
  const normalizedInterval = Number(interval);
  const nextInterval = Number.isFinite(normalizedInterval) && normalizedInterval > 0 ? normalizedInterval : null;
  const nextUnit = unit || 'month';
  if (context === 'editor') {
    editorRecurrence = { interval: nextInterval, unit: nextUnit };
    if (editorRecurringSummary) {
      editorRecurringSummary.textContent = formatRecurrence(nextInterval, nextUnit);
    }
    if (!isPopulatingTaskEditor) {
      scheduleTaskEditorAutosave('recurrence', 400);
    }
  } else {
    modalRecurrence = { interval: nextInterval, unit: nextUnit };
    if (modalRecurringSummary) {
      modalRecurringSummary.textContent = formatRecurrence(nextInterval, nextUnit);
    }
  }
}

function openRecurrenceModal(context) {
  if (!recurrenceModal || !recurrenceInterval || !recurrenceUnit) return;
  recurrenceContext = context;
  const current = getRecurrenceState(context);
  recurrenceInterval.value = current.interval ?? '';
  recurrenceUnit.value = current.unit ?? 'month';
  recurrenceModal.classList.remove('hidden');
  recurrenceInterval.focus();
}

function closeRecurrenceModal() {
  recurrenceModal?.classList.add('hidden');
}

function openNoticeModal() {
  openNoticeModalWithNotice(null, { mode: 'create' });
}

function openNoticeTypeModal() {
  noticeTypeModal?.classList.remove('hidden');
  if (noticeTypeNameInput) noticeTypeNameInput.value = '';
  noticeTypeNameInput?.focus();
}

function closeNoticeTypeModal(options = {}) {
  const { restoreSelection = true } = options;
  noticeTypeModal?.classList.add('hidden');
  if (noticeTypeNameInput) noticeTypeNameInput.value = '';
  if (restoreSelection && noticeType?.value === '__add_new__') {
    renderNoticeTypeSelect(noticeTypePreviousKey);
  }
}

function getCustomRecurrenceEndType() {
  const selected = noticeRecurrenceForm?.querySelector('input[name="notice-custom-end"]:checked');
  return selected?.value ?? 'never';
}

function setCustomRecurrenceEndType(value) {
  const target = ['never', 'on', 'after'].includes(value) ? value : 'never';
  noticeRecurrenceForm?.querySelectorAll('input[name="notice-custom-end"]').forEach(input => {
    input.checked = input.value === target;
  });
}

function applyCustomWeekdaySelection(days = []) {
  const normalized = new Set(normalizeWeekdays(days));
  noticeCustomWeekdays?.querySelectorAll('.weekday-chip').forEach(button => {
    const day = Number(button.dataset.day);
    button.classList.toggle('active', normalized.has(day));
  });
}

function getSelectedCustomWeekdays() {
  const selected = [];
  noticeCustomWeekdays?.querySelectorAll('.weekday-chip.active').forEach(button => {
    const day = Number(button.dataset.day);
    if (Number.isFinite(day)) selected.push(day);
  });
  return normalizeWeekdays(selected);
}

function toggleCustomWeekdayRow() {
  const isWeekly = (noticeCustomUnit?.value ?? 'day') === 'week';
  noticeCustomWeekdaysRow?.classList.toggle('hidden', !isWeekly);
}

function fillCustomRecurrenceForm(rule) {
  const normalized = sanitizeNoticeRecurrenceRule(rule) ?? {
    interval: 1,
    unit: 'week',
    weekdays: [],
    endType: 'never',
    endDate: null,
    endCount: null
  };
  if (noticeCustomInterval) noticeCustomInterval.value = String(normalized.interval);
  if (noticeCustomUnit) noticeCustomUnit.value = normalized.unit;
  applyCustomWeekdaySelection(normalized.weekdays);
  setCustomRecurrenceEndType(normalized.endType);
  if (noticeCustomEndDate) noticeCustomEndDate.value = normalized.endDate ?? '';
  if (noticeCustomEndCount) noticeCustomEndCount.value = normalized.endCount ? String(normalized.endCount) : '';
  toggleCustomWeekdayRow();
}

function readCustomRecurrenceForm() {
  const interval = Number(noticeCustomInterval?.value ?? 1);
  const unit = normalizeRecurrenceUnit(noticeCustomUnit?.value ?? 'week');
  const endType = getCustomRecurrenceEndType();
  const weekdays = unit === 'week' ? getSelectedCustomWeekdays() : [];
  const endDate = endType === 'on' ? (noticeCustomEndDate?.value ?? null) : null;
  const endCount = endType === 'after' ? Number(noticeCustomEndCount?.value ?? 0) : null;
  return sanitizeNoticeRecurrenceRule({
    interval,
    unit,
    weekdays,
    endType,
    endDate,
    endCount
  });
}

function openNoticeRecurrenceModal() {
  const draft = noticeRecurrenceDraft ?? { interval: 1, unit: 'week', weekdays: [], endType: 'never', endDate: null, endCount: null };
  fillCustomRecurrenceForm(draft);
  noticeRecurrenceModal?.classList.remove('hidden');
  noticeCustomInterval?.focus();
}

function closeNoticeRecurrenceModal({ restorePreset = false } = {}) {
  noticeRecurrenceModal?.classList.add('hidden');
  if (restorePreset && noticeRepeatPreset?.value === 'custom' && !noticeRecurrenceDraft) {
    noticeRepeatPreset.value = 'none';
  }
}

function closeNoticeModal() {
  noticeModal?.classList.add('hidden');
  closeNoticeTypeModal({ restoreSelection: true });
  closeNoticeRecurrenceModal();
  activeNoticeId = null;
  noticeModalMode = 'create';
  if (noticeDate) noticeDate.value = '';
  if (noticeTime) noticeTime.value = '';
  if (noticeRepeatPreset) noticeRepeatPreset.value = 'none';
  noticeRecurrenceDraft = null;
  setNoticeModalMode('create');
}

function openNoticeModalWithNotice(notice, options = {}) {
  if (!noticeModal) return;
  const mode = options.mode ?? (notice ? 'view' : 'create');
  activeNoticeId = notice?.id ?? null;
  noticeTitle.value = notice?.title ?? '';
  noticeDate.value = notice?.notify_at ? toLocalDateValue(notice.notify_at) : new Date().toISOString().slice(0, 10);
  noticeTime.value = notice?.notify_at ? toLocalTimeValue(notice.notify_at) : '';
  const rule = getNoticeRecurrenceRule(notice);
  noticeRecurrenceDraft = rule;
  if (noticeRepeatPreset) {
    noticeRepeatPreset.value = getNoticeRepeatPresetFromRule(rule, notice?.notify_at ?? null);
    if (!rule && isBirthdayNoticeType(notice?.notice_type)) {
      noticeRepeatPreset.value = 'yearly';
    }
  }
  renderNoticeTypeSelect(notice?.notice_type ?? 'general');
  if (notice) {
    populateNoticeReadonlyView(notice);
  }
  setNoticeModalMode(mode, notice);
  noticeModal.classList.remove('hidden');
  if (mode === 'view') {
    noticeSaveBtn?.focus();
  } else {
    noticeTitle.focus();
  }
}

function getCheckinExtendMinutes() {
  const value = Number(state.ui?.checkinExtendMinutes);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

function setCheckinExtendMinutes(value) {
  state.ui = state.ui ?? {};
  state.ui.checkinExtendMinutes = value;
}

function addMinutes(date, minutes) {
  const value = Number(minutes);
  const safe = Number.isFinite(value) ? value : 0;
  return new Date(date.getTime() + safe * 60 * 1000);
}

function getTomorrowSameTime() {
  const now = new Date();
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function isTaskOverdue(task) {
  if (!task?.due_at) return false;
  const dueTime = new Date(task.due_at).getTime();
  if (Number.isNaN(dueTime)) return false;
  return dueTime < Date.now();
}

function getDueCheckinTasks() {
  if (!state.workspace) return [];
  const now = Date.now();
  const tasks = Object.values(state.tasks ?? {}).filter(task =>
    task.workspace_id === state.workspace.id && task.next_checkin_at
  );
  return tasks
    .filter(task => {
      if (isDoneStatusKey(task.status) || isCanceledStatusKey(task.status)) return false;
      const dueTime = new Date(task.next_checkin_at).getTime();
      if (Number.isNaN(dueTime) || dueTime > now) return false;
      const snoozeUntil = checkinSnoozes.get(task.id);
      if (snoozeUntil && snoozeUntil > now) return false;
      if (snoozeUntil && snoozeUntil <= now) checkinSnoozes.delete(task.id);
      return true;
    })
    .sort((a, b) => new Date(a.next_checkin_at).getTime() - new Date(b.next_checkin_at).getTime());
}

function openCheckinModal(task) {
  if (!checkinModal) return;
  activeCheckinTaskId = task.id;
  if (checkinTaskTitle) checkinTaskTitle.textContent = task.title;
  checkinModal.classList.remove('hidden');
  checkinYes?.focus();
}

function closeCheckinModal() {
  checkinModal?.classList.add('hidden');
  activeCheckinTaskId = null;
}

function openCheckinProgressModal(task) {
  if (!checkinProgressModal) return;
  checkinProgressTaskId = task.id;
  if (checkinProgressTitle) checkinProgressTitle.textContent = task.title;
  checkinProgressModal.classList.remove('hidden');
  checkinProgressYes?.focus();
}

function closeCheckinProgressModal() {
  checkinProgressModal?.classList.add('hidden');
  checkinProgressTaskId = null;
}

function openCheckinNoModal(task, response, origin = 'checkin') {
  if (!checkinNoModal) return;
  checkinRescheduleContext = { taskId: task.id, response, origin };
  if (checkinNoTitle) checkinNoTitle.textContent = task.title;
  const minutes = getCheckinExtendMinutes();
  if (checkinNoExtend) {
    checkinNoExtend.textContent = `Extend session (${minutes} min)`;
  }
  checkinNoModal.classList.remove('hidden');
  checkinNoExtend?.focus();
}

function closeCheckinNoModal() {
  checkinNoModal?.classList.add('hidden');
}

function updateEditorFollowupVisibility(statusKey) {
  if (!editorFollowupSection) return;
  const show = isWaitingStatusKey(statusKey);
  editorFollowupSection.classList.toggle('hidden', !show);
}

function setEditorFollowupValue(value) {
  if (!editorFollowup) return;
  editorFollowup.value = value ? toDatetimeLocal(value) : '';
}

function ensureEditorWaitingStatus() {
  if (!editorStatus) return;
  if (!isWaitingStatusKey(editorStatus.value)) {
    const waitingKey = getStatusKeyByKind(TaskStatus.WAITING) ?? TaskStatus.WAITING;
    editorStatus.value = waitingKey;
  }
  updateEditorFollowupVisibility(editorStatus.value);
}

function openCheckinRescheduleModal(task, response, origin = null) {
  if (!checkinRescheduleModal) return;
  const resolvedOrigin = origin ?? checkinRescheduleContext?.origin ?? 'checkin';
  checkinRescheduleContext = { taskId: task.id, response, origin: resolvedOrigin };
  if (checkinRescheduleTitle) checkinRescheduleTitle.textContent = task.title;
  if (checkinCustomDue) {
    const tomorrow = getTomorrowSameTime();
    checkinCustomDue.value = toDatetimeLocal(tomorrow.toISOString());
  }
  checkinRescheduleModal.classList.remove('hidden');
  checkinCustomDue?.focus();
}

function closeCheckinRescheduleModal() {
  checkinRescheduleModal?.classList.add('hidden');
  checkinRescheduleContext = null;
}

function snoozeCheckin(taskId, minutes = 60) {
  if (!taskId) return;
  checkinSnoozes.set(taskId, Date.now() + minutes * 60 * 1000);
}

function dismissCheckin(minutes = 60) {
  if (activeCheckinTaskId) {
    snoozeCheckin(activeCheckinTaskId, minutes);
  }
  closeCheckinModal();
}

function dismissCheckinReschedule(minutes = 30) {
  if (checkinRescheduleContext?.taskId) {
    snoozeCheckin(checkinRescheduleContext.taskId, minutes);
  }
  closeCheckinRescheduleModal();
}

function dismissCheckinNo(minutes = 30) {
  if (checkinRescheduleContext?.taskId) {
    snoozeCheckin(checkinRescheduleContext.taskId, minutes);
  }
  closeCheckinNoModal();
  checkinRescheduleContext = null;
}

function syncCheckinModal() {
  if (!checkinModal || checkinModal.classList.contains('hidden')) return;
  if (!activeCheckinTaskId) {
    closeCheckinModal();
    return;
  }
  const task = state.tasks[activeCheckinTaskId];
  if (!task || isDoneStatusKey(task.status) || isCanceledStatusKey(task.status)) {
    closeCheckinModal();
    return;
  }
  if (!task.next_checkin_at) {
    closeCheckinModal();
    return;
  }
  const dueTime = new Date(task.next_checkin_at).getTime();
  if (Number.isNaN(dueTime) || dueTime > Date.now()) {
    closeCheckinModal();
    return;
  }
  if (checkinTaskTitle) checkinTaskTitle.textContent = task.title;
}

function maybeShowCheckinModal() {
  if (!checkinModal) return;
  if (!state.workspace) return;
  if (!checkinModal.classList.contains('hidden')) return;
  if (document.querySelector('.modal:not(.hidden)')) return;
  if (taskEditor?.classList.contains('is-open')) return;
  const due = getDueCheckinTasks();
  if (!due.length) return;
  openCheckinModal(due[0]);
}

async function resolveCheckin(response) {
  if (!activeCheckinTaskId) return;
  const task = state.tasks[activeCheckinTaskId];
  closeCheckinModal();
  if (!task) return;
  await handleCheckIn(task, response);
  maybeShowCheckinModal();
}

async function applyCheckinReschedule(patch) {
  if (!checkinRescheduleContext) return;
  const { taskId, response } = checkinRescheduleContext;
  closeCheckinRescheduleModal();
  const task = state.tasks[taskId];
  if (!task) return;
  if (patch && Object.keys(patch).length) {
    await updateTaskRecord(task.id, patch);
  }
  const updatedTask = state.tasks[taskId] ?? task;
  activeCheckinTaskId = taskId;
  await handleCheckIn(updatedTask, response);
  activeCheckinTaskId = null;
  maybeShowCheckinModal();
}

function renderNoticeTypeSelect(selectedKey = '') {
  if (!noticeType) return;
  noticeType.innerHTML = '';
  const types = ((state.noticeTypes ?? []).length ? state.noticeTypes : DEFAULT_NOTICE_TYPES)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const knownKeys = new Set(types.map(type => type.key));
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type.key;
    option.textContent = type.label;
    noticeType.appendChild(option);
  });
  if (selectedKey && selectedKey !== '__add_new__' && !knownKeys.has(selectedKey)) {
    const unknownOption = document.createElement('option');
    unknownOption.value = selectedKey;
    unknownOption.textContent = selectedKey;
    noticeType.appendChild(unknownOption);
  }
  const addOption = document.createElement('option');
  addOption.value = '__add_new__';
  addOption.textContent = 'Add new type…';
  noticeType.appendChild(addOption);
  if (selectedKey) {
    noticeType.value = selectedKey;
  } else {
    noticeType.value = types[0]?.key ?? 'general';
  }
  if (noticeType.value !== '__add_new__') {
    noticeTypePreviousKey = noticeType.value;
  }
}

function getTaskTypesForWorkspace() {
  if (!state.workspace) return [];
  return (state.taskTypes ?? [])
    .filter(type => type.workspace_id === state.workspace.id && !type.archived)
    .sort((a, b) => (b.is_default ?? 0) - (a.is_default ?? 0) || a.name.localeCompare(b.name));
}

function getStoreRulesForWorkspace() {
  if (!state.workspace) return [];
  return (state.storeRules ?? []).filter(rule => rule.workspace_id === state.workspace.id && !rule.archived);
}

function formatStoreKeywords(keywords) {
  return (keywords ?? []).join(', ');
}

function parseStoreKeywords(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function getDefaultTaskTypeName() {
  const types = getTaskTypesForWorkspace();
  return types.find(type => type.is_default)?.name ?? types[0]?.name ?? '';
}

function hasPendingLocalChanges() {
  return (state.local?.pendingChanges ?? []).length > 0;
}

function persistLocalData() {
  saveLocalData(prepareLocalDataForStorage({
    localSeq: state.local?.localSeq ?? 0,
    pendingChanges: state.local?.pendingChanges ?? [],
    auditLog: state.auditLog ?? [],
    workspaces: state.workspaces ?? [],
    projects: state.projects ?? [],
    statuses: state.statuses ?? [],
    taskTypes: state.taskTypes ?? [],
    users: state.users ?? [],
    workspaceMemberships: state.workspaceMemberships ?? [],
    taskSections: state.taskSections ?? [],
    tasks: state.tasks ?? {},
    taskDependencies: state.taskDependencies ?? [],
    templates: state.templates ?? [],
    workflows: state.workflows ?? [],
    workflowVariants: state.workflowVariants ?? [],
    workflowPhases: state.workflowPhases ?? [],
    workflowVariantPhases: state.workflowVariantPhases ?? [],
    workflowPhaseTasks: state.workflowPhaseTasks ?? [],
    workflowPatterns: state.workflowPatterns ?? [],
    workflowPatternTasks: state.workflowPatternTasks ?? [],
    workflowInstances: state.workflowInstances ?? [],
    workflowInstanceTasks: state.workflowInstanceTasks ?? [],
    scheduleCalendars: state.scheduleCalendars ?? [],
    scheduleEventTypes: state.scheduleEventTypes ?? [],
    scheduleEvents: state.scheduleEvents ?? [],
    notices: state.notices ?? [],
    noticeTypes: state.noticeTypes ?? [],
    storeRules: state.storeRules ?? [],
    shoppingLists: state.shoppingLists ?? [],
    shoppingItems: state.shoppingItems ?? {}
  }));
}

function queueLocalChange(change) {
  const updated = recordLocalChange({
    localSeq: state.local?.localSeq ?? 0,
    pendingChanges: state.local?.pendingChanges ?? []
  }, change);
  state.local.localSeq = updated.localSeq;
  state.local.pendingChanges = updated.pendingChanges;
  appendAuditEvent({
    source: 'local',
    category: 'crud',
    event: `${change?.action ?? 'change'}_queued`,
    entity_type: change?.entity_type ?? null,
    entity_id: change?.entity_id ?? null,
    data: {
      seq: updated.localSeq
    }
  });
}

function normalizePendingTaskCreatePayload(change) {
  const payload = { ...(change?.payload ?? {}) };
  const fallbackId = change?.entity_id ?? payload.id ?? null;
  const localTask = fallbackId ? state.tasks?.[fallbackId] : null;
  if (fallbackId) payload.id = fallbackId;
  payload.workspace_id = payload.workspace_id ?? localTask?.workspace_id ?? state.workspace?.id ?? null;
  const normalizedTitle = normalizeTitleInput(payload.title);
  const fallbackTitle = normalizeTitleInput(localTask?.title ?? '') || 'Untitled task';
  payload.title = normalizedTitle || fallbackTitle;
  payload.status = normalizeTaskStatusValue(payload.status ?? localTask?.status ?? '');
  payload.priority = payload.priority ?? localTask?.priority ?? 'medium';
  payload.assignee_user_id =
    payload.assignee_user_id
    ?? localTask?.assignee_user_id
    ?? getDefaultTaskAssigneeUserId(payload.workspace_id);
  payload.assignee_label = payload.assignee_label ?? localTask?.assignee_label ?? null;
  if (payload.assignee_user_id) {
    payload.assignee_label = null;
  } else if (!payload.assignee_label) {
    payload.assignee_user_id = null;
  }

  // Keep local and pending copies aligned so replay does not repeatedly fail.
  if (change) {
    change.payload = payload;
  }
  if (localTask) {
    localTask.title = payload.title;
    localTask.workspace_id = payload.workspace_id;
    localTask.status = payload.status;
    localTask.priority = payload.priority;
    localTask.assignee_user_id = payload.assignee_user_id ?? null;
    localTask.assignee_label = payload.assignee_label ?? null;
    localTask.updated_at = nowIso();
  }
  return payload;
}

function snapshotLocalData() {
  return {
    auditLog: state.auditLog ?? [],
    workspaces: state.workspaces ?? [],
    projects: state.projects ?? [],
    statuses: state.statuses ?? [],
    taskTypes: state.taskTypes ?? [],
    users: state.users ?? [],
    workspaceMemberships: state.workspaceMemberships ?? [],
    taskSections: state.taskSections ?? [],
    tasks: state.tasks ?? {},
    taskDependencies: state.taskDependencies ?? [],
    templates: state.templates ?? [],
    workflows: state.workflows ?? [],
    workflowVariants: state.workflowVariants ?? [],
    workflowPhases: state.workflowPhases ?? [],
    workflowVariantPhases: state.workflowVariantPhases ?? [],
    workflowPhaseTasks: state.workflowPhaseTasks ?? [],
    workflowPatterns: state.workflowPatterns ?? [],
    workflowPatternTasks: state.workflowPatternTasks ?? [],
    workflowInstances: state.workflowInstances ?? [],
    workflowInstanceTasks: state.workflowInstanceTasks ?? [],
    scheduleCalendars: state.scheduleCalendars ?? [],
    scheduleEventTypes: state.scheduleEventTypes ?? [],
    scheduleEvents: state.scheduleEvents ?? [],
    notices: state.notices ?? [],
    noticeTypes: state.noticeTypes ?? [],
    storeRules: state.storeRules ?? [],
    shoppingLists: state.shoppingLists ?? [],
    shoppingItems: state.shoppingItems ?? {}
  };
}

function applyLocalDataSnapshot(data) {
  state.auditLog = data.auditLog ?? [];
  state.workspaces = data.workspaces ?? [];
  state.projects = data.projects ?? [];
  state.statuses = data.statuses ?? [];
  state.taskTypes = data.taskTypes ?? [];
  state.users = data.users ?? [];
  state.workspaceMemberships = data.workspaceMemberships ?? [];
  state.taskSections = (data.taskSections ?? []).map(normalizeTaskSection);
  state.tasks = data.tasks ?? {};
  state.taskDependencies = data.taskDependencies ?? [];
  state.templates = data.templates ?? [];
  state.workflows = data.workflows ?? [];
  state.workflowVariants = data.workflowVariants ?? [];
  state.workflowPhases = data.workflowPhases ?? [];
  state.workflowVariantPhases = data.workflowVariantPhases ?? [];
  state.workflowPhaseTasks = data.workflowPhaseTasks ?? [];
  state.workflowPatterns = data.workflowPatterns ?? data.workflowFragments ?? [];
  state.workflowPatternTasks = data.workflowPatternTasks ?? data.workflowFragmentTasks ?? [];
  state.workflowInstances = data.workflowInstances ?? [];
  state.workflowInstanceTasks = data.workflowInstanceTasks ?? [];
  state.scheduleCalendars = (data.scheduleCalendars ?? []).map(normalizeScheduleCalendar);
  state.scheduleEventTypes = (data.scheduleEventTypes ?? []).map(normalizeScheduleEventType);
  state.scheduleEvents = (data.scheduleEvents ?? []).map(normalizeScheduleEvent);
  state.notices = data.notices ?? [];
  state.noticeTypes = data.noticeTypes ?? [];
  state.storeRules = data.storeRules ?? [];
  state.shoppingLists = data.shoppingLists ?? [];
  state.shoppingItems = data.shoppingItems ?? {};
}

async function pushPendingChanges() {
  const pending = [...(state.local?.pendingChanges ?? [])];
  if (!pending.length || !state.workspace) {
    return { applied: [], remaining: pending, error: null };
  }

  const result = await replayPendingChanges(pending, async (change) => {
    if (!change) return;
    if (change.entity_type === 'task') {
      if (change.action === 'create') {
        const payload = normalizePendingTaskCreatePayload(change);
        let created;
        try {
          created = await api.createTask(payload);
        } catch (err) {
          if (!(err?.status >= 400 && err.status < 500)) throw err;
          // Retry with a minimal valid payload to recover from older malformed queue entries.
          const minimalPayload = {
            id: payload.id ?? change.entity_id ?? createId(),
            workspace_id: payload.workspace_id ?? state.workspace?.id ?? null,
            title: normalizeTitleInput(payload.title) || 'Untitled task',
            status: normalizeTaskStatusValue(payload.status),
            priority: 'medium'
          };
          if (!minimalPayload.workspace_id) throw err;
          change.payload = { ...minimalPayload };
          created = await api.createTask(minimalPayload);
        }
        if (created) upsertTask(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateTask(change.entity_id, change.payload ?? {});
        if (updated) upsertTask(updated);
        return;
      }
      if (change.action === 'reparent') {
        const updated = await api.reparentTask(change.entity_id, change.payload?.new_parent_id ?? null);
        if (updated) upsertTask(updated);
        return;
      }
      if (change.action === 'delete') {
        const result = await api.deleteTask(change.entity_id);
        if (result?.ids?.length) {
          result.ids.forEach(taskId => delete state.tasks[taskId]);
        } else {
          delete state.tasks[change.entity_id];
        }
        return;
      }
    }

    if (change.entity_type === 'workspace') {
      if (change.action === 'create') {
        const created = await api.createWorkspace(change.payload ?? {});
        if (created) upsertWorkspace(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateWorkspace(change.entity_id, change.payload ?? {});
        if (updated) upsertWorkspace(updated);
        return;
      }
      if (change.action === 'delete') {
        await api.deleteWorkspace(change.entity_id);
        state.workspaces = (state.workspaces ?? []).filter(ws => ws.id !== change.entity_id);
        if (state.workspace?.id === change.entity_id) {
          state.workspace = null;
        }
      }
    }

    if (change.entity_type === 'project') {
      if (change.action === 'create') {
        const created = await api.createProject(change.payload ?? {});
        if (created) upsertProject(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateProject(change.entity_id, change.payload ?? {});
        if (updated) upsertProject(updated);
        return;
      }
      if (change.action === 'delete') {
        await api.deleteProject(change.entity_id);
        state.projects = (state.projects ?? []).filter(project => project.id !== change.entity_id);
      }
    }

    if (change.entity_type === 'status') {
      if (change.action === 'create') {
        const created = await api.createStatus(change.payload ?? {});
        if (created) upsertStatus(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateStatus(change.entity_id, change.payload ?? {});
        if (updated) upsertStatus(updated);
        return;
      }
      if (change.action === 'delete') {
        await api.deleteStatus(change.entity_id);
        state.statuses = (state.statuses ?? []).filter(status => status.id !== change.entity_id);
      }
    }

    if (change.entity_type === 'task_type') {
      if (change.action === 'create') {
        const created = await api.createTaskType(change.payload ?? {});
        if (created) upsertTaskType(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateTaskType(change.entity_id, change.payload ?? {});
        if (updated) upsertTaskType(updated);
        return;
      }
      if (change.action === 'delete') {
        await api.deleteTaskType(change.entity_id);
        state.taskTypes = (state.taskTypes ?? []).filter(type => type.id !== change.entity_id);
      }
    }

    if (change.entity_type === 'user') {
      if (change.action === 'create') {
        const created = await api.createUser(change.payload ?? {});
        if (created) upsertUser(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateUser(change.entity_id, change.payload ?? {});
        if (updated) upsertUser(updated);
        return;
      }
    }

    if (change.entity_type === 'workspace_membership') {
      if (change.action === 'create') {
        const created = await api.createWorkspaceMembership(change.payload ?? {});
        if (created) upsertWorkspaceMembership(created);
        return;
      }
      if (change.action === 'update') {
        const updated = await api.updateWorkspaceMembership(change.entity_id, change.payload ?? {});
        if (updated) upsertWorkspaceMembership(updated);
        return;
      }
      if (change.action === 'delete') {
        await api.deleteWorkspaceMembership(change.entity_id);
        state.workspaceMemberships = (state.workspaceMemberships ?? []).filter(item => item.id !== change.entity_id);
      }
    }
  }, { nowMs: Date.now() });

  if (result.applied.length || result.error) {
    state.local.pendingChanges = result.remaining;
    persistLocalData();
  }

  return result;
}

function ensureLocalWorkspaceDefaults(workspace) {
  if (!workspace) return;
  const hasStatuses = (state.statuses ?? []).some(status => status.workspace_id === workspace.id);
  if (!hasStatuses) {
    const now = new Date().toISOString();
    const defaults = DEFAULT_STATUS_DEFS.map(def => ({
      id: createId(),
      workspace_id: workspace.id,
      key: def.key,
      label: def.label,
      kind: def.kind,
      sort_order: def.sort_order,
      kanban_visible: def.kanban_visible,
      created_at: now,
      updated_at: now
    }));
    state.statuses = [...(state.statuses ?? []), ...defaults];
  }
  const hasTaskTypes = (state.taskTypes ?? []).some(type => type.workspace_id === workspace.id);
  if (!hasTaskTypes) {
    const now = new Date().toISOString();
    const defaults = DEFAULT_TASK_TYPE_DEFS.map(def => ({
      id: createId(),
      workspace_id: workspace.id,
      name: def.name,
      is_default: def.is_default ? 1 : 0,
      archived: 0,
      created_at: now,
      updated_at: now
    }));
    state.taskTypes = [...(state.taskTypes ?? []), ...defaults];
  }
  const workspaceCalendars = (state.scheduleCalendars ?? [])
    .map(normalizeScheduleCalendar)
    .filter((calendar) => calendar.workspace_id === workspace.id && !calendar.archived);
  if (!workspaceCalendars.length) {
    const now = new Date().toISOString();
    const fallbackCalendar = normalizeScheduleCalendar({
      id: createId(),
      workspace_id: workspace.id,
      name: 'Primary',
      color: SCHEDULE_CALENDAR_COLOR_PALETTE[0],
      time_zone: getSchedulingDisplayTimeZone(),
      sort_order: 10,
      archived: 0,
      created_at: now,
      updated_at: now
    });
    state.scheduleCalendars = [...(state.scheduleCalendars ?? []), fallbackCalendar];
  }
  const workspaceEventTypes = (state.scheduleEventTypes ?? [])
    .map(normalizeScheduleEventType)
    .filter((type) => type.workspace_id === workspace.id && !type.archived);
  if (!workspaceEventTypes.length) {
    const now = new Date().toISOString();
    const defaults = DEFAULT_SCHEDULE_EVENT_TYPE_DEFS.map((def) => normalizeScheduleEventType({
      id: createId(),
      workspace_id: workspace.id,
      name: def.name,
      description_template: def.description_template ?? '',
      default_color: def.default_color ?? null,
      archived: 0,
      created_at: now,
      updated_at: now
    }));
    state.scheduleEventTypes = [...(state.scheduleEventTypes ?? []), ...defaults];
  }
  const resolvedActiveCalendarId = getActiveScheduleCalendarId();
  if (resolvedActiveCalendarId !== state.ui?.schedulingActiveCalendarId) {
    setActiveScheduleCalendarId(resolvedActiveCalendarId);
  }
  if (ensureScheduleEventsHaveValidCalendarIds(workspace)) {
    state.ui = state.ui ?? {};
    state.ui.schedulingHiddenCalendarIds = normalizeSchedulingHiddenCalendarIds(
      state.ui.schedulingHiddenCalendarIds
    );
  }
  ensureScheduleEventsHaveValidTypeIds(workspace);
}

async function loadWorkspaces() {
  if (isAuthGateEnabled() && !isAuthenticatedActor()) {
    clearWorkspaceDomainData();
    return;
  }
  let workspaces = state.workspaces ?? [];
  const allowRemote = !hasPendingLocalChanges();
  if (allowRemote) {
    try {
      workspaces = await api.listWorkspaces();
      if (!workspaces.length) {
        const created = await api.createWorkspace({ name: 'Personal', type: 'personal' });
        workspaces = [created];
      }
    } catch {
      // offline: keep local workspaces
    }
  }
  if (!workspaces.length) {
    const now = new Date().toISOString();
    const localWorkspace = {
      id: createId(),
      name: 'Personal',
      type: 'personal',
      archived: 0,
      created_at: now,
      updated_at: now
    };
    workspaces = [localWorkspace];
  }
  const normalized = workspaces.map(normalizeWorkspace);
  state.workspaces = normalized;
  const preferredId = state.ui?.activeWorkspaceId;
  state.workspace = normalized.find(ws => ws.id === preferredId && !ws.archived)
    ?? normalized.find(ws => !ws.archived)
    ?? normalized[0];
  state.ui.activeWorkspaceId = state.workspace?.id ?? null;
  ensureLocalWorkspaceDefaults(state.workspace);
  persistLocalData();
}

async function loadWorkspaceData() {
  if (isAuthGateEnabled() && !isAuthenticatedActor()) {
    clearWorkspaceDomainData();
    return;
  }
  if (!state.workspace) return;
  if (!hasPendingLocalChanges()) {
    try {
      state.projects = (await api.listProjects(state.workspace.id)).map(normalizeProject);
      state.templates = (await api.listTemplates(state.workspace.id)).map(normalizeTemplate);
      state.statuses = (await api.listStatuses(state.workspace.id)).map(normalizeStatus);
      state.taskTypes = (await api.listTaskTypes(state.workspace.id)).map(normalizeTaskType);
      state.users = (await api.listUsers({ workspaceId: state.workspace.id })).map(normalizeUser);
      state.workspaceMemberships = (await api.listWorkspaceMemberships(state.workspace.id)).map(normalizeWorkspaceMembership);
      state.storeRules = (await api.listStoreRules(state.workspace.id)).map(normalizeStoreRule);
      state.noticeTypes = (await api.listNoticeTypes(state.workspace.id)).map(normalizeNoticeType);
      state.notices = (await api.listNotices(state.workspace.id)).map(normalizeNotice);
      const tasks = await api.listTasks(state.workspace.id);
      state.tasks = Object.fromEntries(tasks.map(task => [task.id, normalizeTask(task)]));
      state.taskDependencies = await api.listTaskDependencies(state.workspace.id);
      state.shoppingLists = (await api.listShoppingLists(state.workspace.id)).map(normalizeShoppingList);
      const shoppingItems = await api.listShoppingItems(state.workspace.id);
      state.shoppingItems = Object.fromEntries(shoppingItems.map(item => [item.id, normalizeShoppingItem(item)]));
    } catch {
      // offline: keep local data
    }
  }
  reconcileWorkflowWorkspaceIds();
  backfillWorkflowTaskTypeMarkers();
  ensureLocalWorkspaceDefaults(state.workspace);
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const preferredListId = state.ui?.activeShoppingListId;
  const availableLists = state.shoppingLists.filter(list =>
    shouldShowShoppingListInSidebar(list, { showArchived })
  );
  const nonInboxLists = availableLists.filter((list) => !isShoppingInboxList(list));
  const activeList = availableLists.find(list => list.id === preferredListId)
    ?? nonInboxLists.find(list => !list.archived && !isShoppingListComplete(list.id))
    ?? nonInboxLists[0]
    ?? availableLists[0]
    ?? null;
  state.ui.activeShoppingListId = activeList?.id ?? null;
  persistLocalData();
}

async function refreshWorkspace() {
  if (!state.workspace) {
    render();
    return;
  }
  await loadWorkspaceData();
  await ensureTemplateReminders();
  await loadWorkspaceData();
  render();
  await maybePromptTemplate();
}

async function selectWorkspace(workspace) {
  state.workspace = workspace;
  state.ui.activeWorkspaceId = workspace.id;
  state.ui.activeProjectId = null;
  clearActiveWorkflowChecklistInstanceId();
  state.ui.syncCursor = 0;
  state.ui.aiSuggestions = [];
  state.ui.aiSuggestionNotes = '';
  setActiveView('tasks');
  await refreshWorkspace();
  await primeSyncCursor();
}

function normalizeWorkspace(workspace) {
  return {
    ...workspace,
    org_id: workspace.org_id ?? DEFAULT_ORG_ID,
    archived: Boolean(workspace.archived)
  };
}

function normalizeProjectKind(kind) {
  const value = String(kind ?? '').trim().toLowerCase();
  if (value === PROJECT_KIND_LIST) return PROJECT_KIND_LIST;
  return PROJECT_KIND_PROJECT;
}

function normalizeProject(project) {
  return {
    ...project,
    kind: normalizeProjectKind(project?.kind),
    archived: Boolean(project.archived)
  };
}

function normalizeTaskSection(section) {
  if (!section || typeof section !== 'object') return section;
  return {
    ...section,
    project_id: section.project_id || null,
    completed_visibility: normalizeSectionCompletedVisibility(section.completed_visibility),
    future_visibility_days: normalizeSectionFutureVisibilityDays(section.future_visibility_days)
  };
}

function normalizeTemplate(template) {
  return { ...template, archived: Boolean(template.archived) };
}

function normalizeStatus(status) {
  return {
    ...status,
    kanban_visible: status.kanban_visible === undefined ? true : Boolean(status.kanban_visible)
  };
}

function normalizeTaskType(type) {
  return {
    ...type,
    is_default: Number(type.is_default) ? 1 : 0,
    archived: Number(type.archived) ? 1 : 0
  };
}

function normalizeUser(user) {
  return {
    ...user,
    org_role: normalizeOrgRole(user.org_role),
    archived: Number(user.archived) ? 1 : 0
  };
}

function normalizeWorkspaceMembership(membership) {
  return {
    ...membership,
    archived: Number(membership.archived) ? 1 : 0
  };
}

function normalizeStoreRule(rule) {
  let keywords = [];
  try {
    keywords = Array.isArray(rule.keywords) ? rule.keywords : JSON.parse(rule.keywords_json ?? '[]');
  } catch {
    keywords = [];
  }
  return {
    ...rule,
    keywords,
    archived: Number(rule.archived) ? 1 : 0
  };
}

function normalizeNotice(notice) {
  let recurrenceRule = notice.recurrence_rule ?? null;
  if (!recurrenceRule && notice.recurrence_rule_json) {
    try {
      recurrenceRule = JSON.parse(notice.recurrence_rule_json);
    } catch {
      recurrenceRule = null;
    }
  }
  return {
    ...notice,
    notice_type: notice.notice_type ?? 'general',
    dismissed_at: notice.dismissed_at ?? null,
    notice_sent_at: notice.notice_sent_at ?? null,
    recurrence_interval: notice.recurrence_interval ?? null,
    recurrence_unit: notice.recurrence_unit ?? null,
    recurrence_rule_json: notice.recurrence_rule_json ?? null,
    recurrence_rule: sanitizeNoticeRecurrenceRule(recurrenceRule),
    recurrence_occurrence_count: Number(notice.recurrence_occurrence_count ?? 0)
  };
}

function normalizeNoticeType(type) {
  return {
    ...type,
    label: type.label ?? type.key ?? 'General',
    key: type.key ?? 'general'
  };
}

function normalizeShoppingList(list) {
  return { ...list, archived: Boolean(list.archived) };
}

function normalizeShoppingItem(item) {
  return { ...item, is_checked: Number(item.is_checked) ? 1 : 0 };
}

function normalizeScheduleEventKind(kind) {
  const key = String(kind ?? '').trim().toLowerCase();
  if (key === 'time-block') return 'time-block';
  if (key === 'day-off') return 'day-off';
  return 'event';
}

function normalizeScheduleEventRecurrenceInterval(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return null;
  return rounded;
}

function normalizeScheduleEventRecurrenceUnit(value) {
  const unit = String(value ?? '').trim().toLowerCase();
  if (!unit) return null;
  return RECURRENCE_UNITS.has(unit) ? unit : null;
}

function normalizeScheduleEventReminderOffsetMinutes(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  if (rounded < 0) return null;
  return rounded;
}

function normalizeScheduleEventAttendeeUserIds(value) {
  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      source = parsed;
    } catch {
      source = trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  const normalized = [];
  source.forEach((entry) => {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function normalizeScheduleEventColor(value) {
  const color = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return null;
}

function pickSchedulePaletteColor(seed = '') {
  const text = String(seed ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  const paletteSize = SCHEDULE_CALENDAR_COLOR_PALETTE.length;
  const paletteIndex = Math.abs(hash) % paletteSize;
  return SCHEDULE_CALENDAR_COLOR_PALETTE[paletteIndex];
}

function getNextScheduleEventTypeColor() {
  const usedColors = new Set(
    getScheduleEventTypesForWorkspace({ includeArchived: true })
      .map((type) => normalizeScheduleEventColor(type.default_color))
      .filter(Boolean)
  );
  const unused = SCHEDULE_CALENDAR_COLOR_PALETTE.find((color) => !usedColors.has(color));
  if (unused) return unused;
  const fallbackIndex = usedColors.size % SCHEDULE_CALENDAR_COLOR_PALETTE.length;
  return SCHEDULE_CALENDAR_COLOR_PALETTE[fallbackIndex];
}

function normalizeScheduleEventType(type) {
  const fallbackSeed = type?.id ?? type?.name ?? '';
  return {
    ...type,
    name: normalizeTitleInput(type?.name ?? '') || 'Event type',
    description_template: String(type?.description_template ?? ''),
    default_color: normalizeScheduleEventColor(type?.default_color) ?? pickSchedulePaletteColor(fallbackSeed),
    archived: Number(type?.archived) ? 1 : 0
  };
}

function getScheduleEventTypesForWorkspace(options = {}) {
  if (!state.workspace) return [];
  const includeArchived = options.includeArchived === true;
  return (state.scheduleEventTypes ?? [])
    .map(normalizeScheduleEventType)
    .filter((type) => {
      if (type.workspace_id !== state.workspace.id) return false;
      if (!includeArchived && type.archived) return false;
      return true;
    })
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

function getScheduleEventTypeById(typeId, options = {}) {
  if (!typeId) return null;
  const id = String(typeId).trim();
  if (!id) return null;
  return getScheduleEventTypesForWorkspace(options).find((type) => type.id === id) ?? null;
}

function resolveScheduleEventTypeId(typeId) {
  const id = String(typeId ?? '').trim();
  if (!id) return null;
  return getScheduleEventTypeById(id) ? id : null;
}

function getScheduleEventTypeColor(typeId) {
  const type = getScheduleEventTypeById(typeId);
  return normalizeScheduleEventColor(type?.default_color) ?? null;
}

function getResolvedScheduleEventColor(event, fallbackColor = null) {
  const override = normalizeScheduleEventColor(event?.color_override);
  if (override) return override;
  const typeColor = getScheduleEventTypeColor(event?.event_type_id);
  if (typeColor) return typeColor;
  const fallback = normalizeScheduleEventColor(fallbackColor);
  if (fallback) return fallback;
  return SCHEDULE_CALENDAR_COLOR_PALETTE[0];
}

function normalizeScheduleCalendarColor(value) {
  return normalizeScheduleEventColor(value) ?? SCHEDULE_CALENDAR_COLOR_PALETTE[0];
}

function normalizeScheduleCalendar(calendar) {
  const sortOrder = Number.isFinite(Number(calendar?.sort_order))
    ? Math.floor(Number(calendar.sort_order))
    : null;
  return {
    ...calendar,
    name: normalizeTitleInput(calendar?.name ?? '') || 'Calendar',
    color: normalizeScheduleCalendarColor(calendar?.color),
    time_zone: normalizeTimeZone(calendar?.time_zone ?? getSystemTimeZone()),
    archived: Number(calendar?.archived) ? 1 : 0,
    sort_order: sortOrder
  };
}

function normalizeScheduleEvent(event) {
  const attendeeUserIds = normalizeScheduleEventAttendeeUserIds(event?.attendee_user_ids);
  const organizerUserId = String(event?.organizer_user_id ?? '').trim() || null;
  return {
    ...event,
    kind: normalizeScheduleEventKind(event?.kind),
    title: normalizeTitleInput(event?.title ?? '') || 'Untitled event',
    calendar_id: event?.calendar_id ?? null,
    event_type_id: event?.event_type_id ?? null,
    color_override: normalizeScheduleEventColor(event?.color_override),
    organizer_user_id: organizerUserId,
    attendee_user_ids: attendeeUserIds,
    start_at: event?.start_at ?? null,
    end_at: event?.end_at ?? null,
    all_day: Number(event?.all_day) ? 1 : 0,
    notes: String(event?.notes ?? ''),
    reminder_offset_minutes: normalizeScheduleEventReminderOffsetMinutes(event?.reminder_offset_minutes),
    reminder_last_occurrence_at: String(event?.reminder_last_occurrence_at ?? '').trim() || null,
    recurrence_interval: normalizeScheduleEventRecurrenceInterval(event?.recurrence_interval),
    recurrence_unit: normalizeScheduleEventRecurrenceUnit(event?.recurrence_unit),
    archived: Number(event?.archived) ? 1 : 0
  };
}

function getScheduleCalendarsForWorkspace(options = {}) {
  if (!state.workspace) return [];
  const includeArchived = options.includeArchived === true;
  return (state.scheduleCalendars ?? [])
    .map(normalizeScheduleCalendar)
    .filter((calendar) => {
      if (calendar.workspace_id !== state.workspace.id) return false;
      if (!includeArchived && calendar.archived) return false;
      return true;
    })
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.sort_order) ? a.sort_order : Number.POSITIVE_INFINITY;
      const bOrder = Number.isFinite(b.sort_order) ? b.sort_order : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
}

function getScheduleCalendarById(calendarId, options = {}) {
  if (!calendarId) return null;
  const calendars = getScheduleCalendarsForWorkspace(options);
  return calendars.find((calendar) => calendar.id === calendarId) ?? null;
}

function getScheduleCalendarTimeZone(calendarId, fallback = getSchedulingDisplayTimeZone()) {
  const calendar = getScheduleCalendarById(calendarId, { includeArchived: true });
  return normalizeTimeZone(calendar?.time_zone ?? fallback, fallback);
}

function getDefaultScheduleCalendarForWorkspace() {
  return getScheduleCalendarsForWorkspace({ includeArchived: false })[0] ?? null;
}

function getActiveScheduleCalendarId() {
  const activeId = String(state.ui?.schedulingActiveCalendarId ?? '').trim();
  const calendars = getScheduleCalendarsForWorkspace({ includeArchived: false });
  if (activeId && calendars.some((calendar) => calendar.id === activeId)) return activeId;
  return calendars[0]?.id ?? null;
}

function setActiveScheduleCalendarId(calendarId) {
  state.ui = state.ui ?? {};
  state.ui.schedulingActiveCalendarId = calendarId ? String(calendarId) : null;
}

function resolveScheduleCalendarId(calendarId) {
  const id = String(calendarId ?? '').trim();
  if (id && getScheduleCalendarById(id)) return id;
  return getActiveScheduleCalendarId() ?? getDefaultScheduleCalendarForWorkspace()?.id ?? null;
}

function pickNextScheduleCalendarColor() {
  const calendars = getScheduleCalendarsForWorkspace({ includeArchived: true });
  const usage = new Map(SCHEDULE_CALENDAR_COLOR_PALETTE.map((color) => [color, 0]));
  calendars.forEach((calendar) => {
    const color = normalizeScheduleCalendarColor(calendar.color);
    usage.set(color, (usage.get(color) ?? 0) + 1);
  });
  let bestColor = SCHEDULE_CALENDAR_COLOR_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  SCHEDULE_CALENDAR_COLOR_PALETTE.forEach((color) => {
    const count = usage.get(color) ?? 0;
    if (count < bestCount) {
      bestColor = color;
      bestCount = count;
    }
  });
  return bestColor;
}

function normalizeSchedulingHiddenCalendarIds(value) {
  if (!Array.isArray(value)) return [];
  const calendars = getScheduleCalendarsForWorkspace({ includeArchived: true });
  const validIds = new Set(calendars.map((calendar) => calendar.id));
  const seen = new Set();
  const hidden = [];
  value.forEach((entry) => {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id) || !validIds.has(id)) return;
    seen.add(id);
    hidden.push(id);
  });
  return hidden;
}

function getSchedulingHiddenCalendarIds() {
  return normalizeSchedulingHiddenCalendarIds(state.ui?.schedulingHiddenCalendarIds);
}

function isSchedulingCalendarVisible(calendarId) {
  const id = String(calendarId ?? '').trim();
  if (!id) return true;
  return !getSchedulingHiddenCalendarIds().includes(id);
}

function setSchedulingCalendarVisible(calendarId, visible) {
  const id = String(calendarId ?? '').trim();
  if (!id) return;
  const hidden = new Set(getSchedulingHiddenCalendarIds());
  if (visible) {
    hidden.delete(id);
  } else {
    hidden.add(id);
  }
  state.ui = state.ui ?? {};
  state.ui.schedulingHiddenCalendarIds = normalizeSchedulingHiddenCalendarIds(Array.from(hidden));
}

function ensureScheduleEventsHaveValidCalendarIds(workspace) {
  if (!workspace?.id) return false;
  const defaultCalendar = getDefaultScheduleCalendarForWorkspace();
  const availableIds = new Set(getScheduleCalendarsForWorkspace().map((calendar) => calendar.id));
  if (!defaultCalendar && !availableIds.size) return false;
  let changed = false;
  state.scheduleEvents = (state.scheduleEvents ?? []).map((event) => {
    const normalized = normalizeScheduleEvent(event);
    if (normalized.workspace_id !== workspace.id) return normalized;
    if (normalized.archived) return normalized;
    const calendarId = String(normalized.calendar_id ?? '').trim();
    if (calendarId && availableIds.has(calendarId)) return normalized;
    changed = true;
    return {
      ...normalized,
      calendar_id: defaultCalendar?.id ?? null,
      updated_at: nowIso()
    };
  });
  return changed;
}

function ensureScheduleEventsHaveValidTypeIds(workspace) {
  if (!workspace?.id) return false;
  const availableIds = new Set(getScheduleEventTypesForWorkspace({ includeArchived: false }).map((type) => type.id));
  let changed = false;
  state.scheduleEvents = (state.scheduleEvents ?? []).map((event) => {
    const normalized = normalizeScheduleEvent(event);
    if (normalized.workspace_id !== workspace.id) return normalized;
    if (normalized.archived) return normalized;
    const typeId = String(normalized.event_type_id ?? '').trim();
    if (!typeId || availableIds.has(typeId)) return normalized;
    changed = true;
    return {
      ...normalized,
      event_type_id: null,
      updated_at: nowIso()
    };
  });
  return changed;
}

function getScheduleEventsForWorkspace() {
  if (!state.workspace) return [];
  const visibleCalendarIds = new Set(
    getScheduleCalendarsForWorkspace()
      .filter((calendar) => isSchedulingCalendarVisible(calendar.id))
      .map((calendar) => calendar.id)
  );
  return (state.scheduleEvents ?? [])
    .map(normalizeScheduleEvent)
    .filter((event) => {
      if (event.workspace_id !== state.workspace.id) return false;
      if (event.archived) return false;
      if (!event.calendar_id) return true;
      return visibleCalendarIds.has(event.calendar_id);
    })
    .sort((a, b) => String(a.start_at ?? '').localeCompare(String(b.start_at ?? '')));
}

function normalizeTask(task) {
  return {
    ...task,
    status: normalizeTaskStatusValue(task?.status),
    tags: normalizeTagList(task?.tags ?? []),
    auto_debit: Number(task.auto_debit) ? 1 : 0,
    template_prompt_pending: Number(task.template_prompt_pending) ? 1 : 0,
    task_type: task.task_type ?? 'task',
    group_label: task.group_label ?? null,
    assignee_user_id: task.assignee_user_id ?? null,
    assignee_label: task.assignee_label ?? null
  };
}

function upsertTask(task) {
  state.tasks[task.id] = normalizeTask(task);
}

function upsertWorkspace(workspace) {
  state.workspaces = state.workspaces ?? [];
  const normalized = normalizeWorkspace(workspace);
  const index = state.workspaces.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.workspaces[index] = normalized;
  } else {
    state.workspaces.push(normalized);
  }
  if (state.workspace?.id === normalized.id) {
    state.workspace = normalized;
  }
}

function upsertProject(project) {
  state.projects = state.projects ?? [];
  const normalized = normalizeProject(project);
  const index = state.projects.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.projects[index] = normalized;
  } else {
    state.projects.push(normalized);
  }
}

function upsertTemplate(template) {
  state.templates = state.templates ?? [];
  const normalized = normalizeTemplate(template);
  const index = state.templates.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.templates[index] = normalized;
  } else {
    state.templates.push(normalized);
  }
}

function upsertStatus(status) {
  state.statuses = state.statuses ?? [];
  const normalized = normalizeStatus(status);
  const index = state.statuses.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.statuses[index] = normalized;
  } else {
    state.statuses.push(normalized);
  }
}

function upsertTaskType(type) {
  state.taskTypes = state.taskTypes ?? [];
  const normalized = normalizeTaskType(type);
  const index = state.taskTypes.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.taskTypes[index] = normalized;
  } else {
    state.taskTypes.push(normalized);
  }
}

function upsertUser(user) {
  state.users = state.users ?? [];
  const normalized = normalizeUser(user);
  const index = state.users.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.users[index] = normalized;
  } else {
    state.users.push(normalized);
  }
}

function upsertWorkspaceMembership(membership) {
  state.workspaceMemberships = state.workspaceMemberships ?? [];
  const normalized = normalizeWorkspaceMembership(membership);
  const index = state.workspaceMemberships.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.workspaceMemberships[index] = normalized;
  } else {
    state.workspaceMemberships.push(normalized);
  }
}

function upsertStoreRule(rule) {
  state.storeRules = state.storeRules ?? [];
  const normalized = normalizeStoreRule(rule);
  const index = state.storeRules.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.storeRules[index] = normalized;
  } else {
    state.storeRules.push(normalized);
  }
}

function upsertNotice(notice) {
  state.notices = state.notices ?? [];
  const normalized = normalizeNotice(notice);
  const index = state.notices.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.notices[index] = normalized;
  } else {
    state.notices.push(normalized);
  }
}

function upsertNoticeType(type) {
  state.noticeTypes = state.noticeTypes ?? [];
  const normalized = normalizeNoticeType(type);
  const index = state.noticeTypes.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.noticeTypes[index] = normalized;
  } else {
    state.noticeTypes.push(normalized);
  }
}

function upsertShoppingList(list) {
  state.shoppingLists = state.shoppingLists ?? [];
  const normalized = normalizeShoppingList(list);
  const index = state.shoppingLists.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.shoppingLists[index] = normalized;
  } else {
    state.shoppingLists.push(normalized);
  }
}

function upsertShoppingItem(item) {
  state.shoppingItems = state.shoppingItems ?? {};
  const normalized = normalizeShoppingItem(item);
  state.shoppingItems[normalized.id] = normalized;
}

function removeShoppingItemsForList(listId) {
  if (!state.shoppingItems) return;
  Object.values(state.shoppingItems).forEach(item => {
    if (item.list_id === listId) {
      delete state.shoppingItems[item.id];
    }
  });
}

async function createTaskRecord(payload) {
  if (!state.workspace) return null;
  const parentId = payload.parent_id ?? null;
  const statusKey = parentId ? null : normalizeTaskStatusValue(payload.status);
  const sortOrder = payload.sort_order === undefined || payload.sort_order === null
    ? getNextTaskSortOrder(parentId, statusKey)
    : payload.sort_order;
  const normalizedTitle = normalizeTitleInput(payload.title);
  const normalizedType = payload.type_label ? normalizeTitleInput(payload.type_label) : payload.type_label;
  const normalizedGroup = payload.group_label ? normalizeTitleInput(payload.group_label) : payload.group_label;
  const normalizedAssigneeLabel = payload.assignee_label ? normalizeTitleInput(payload.assignee_label) : null;
  const normalizedTags = normalizeTagList(payload.tags ?? []);
  const explicitAssigneeUserId = payload.assignee_user_id ?? null;
  const explicitAssigneeLabel = normalizedAssigneeLabel;
  const defaultAssigneeUserId = (!explicitAssigneeUserId && !explicitAssigneeLabel)
    ? getDefaultTaskAssigneeUserId(state.workspace.id)
    : null;
  const taskPayload = {
    ...payload,
    title: normalizedTitle || 'Untitled task',
    type_label: normalizedType ?? null,
    group_label: normalizedGroup ?? null,
    tags: normalizedTags,
    assignee_user_id: explicitAssigneeUserId ?? defaultAssigneeUserId ?? null,
    assignee_label: explicitAssigneeLabel,
    sort_order: sortOrder,
    workspace_id: state.workspace.id
  };
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createTask(taskPayload);
      if (created) {
        upsertTask(created);
        appendCrudEvent({
          source: 'app',
          event: 'task_created',
          entity_type: 'task',
          entity_id: created.id
        });
      }
      return created;
    } catch (err) {
      if (err?.status && err.status >= 400 && err.status < 500) {
        alert(err?.message ?? 'Unable to create task.');
        return null;
      }
      // fall back to local create
    }
  }
  const now = new Date().toISOString();
  const status = normalizeTaskStatusValue(taskPayload.status);
  let localTask = normalizeTask({
    id: createId(),
    workspace_id: state.workspace.id,
    parent_id: taskPayload.parent_id ?? null,
    project_id: taskPayload.project_id ?? null,
    group_label: taskPayload.group_label ?? null,
    title: taskPayload.title,
    description_md: taskPayload.description_md ?? '',
    status,
    priority: taskPayload.priority ?? 'medium',
    urgency: taskPayload.urgency ? 1 : 0,
    type_label: taskPayload.type_label ?? null,
    recurrence_interval: taskPayload.recurrence_interval ?? null,
    recurrence_unit: taskPayload.recurrence_unit ?? null,
    reminder_offset_days: taskPayload.reminder_offset_days ?? null,
    auto_debit: taskPayload.auto_debit ? 1 : 0,
    reminder_sent_at: taskPayload.reminder_sent_at ?? null,
    recurrence_parent_id: taskPayload.recurrence_parent_id ?? null,
    recurrence_generated_at: taskPayload.recurrence_generated_at ?? null,
    template_id: taskPayload.template_id ?? null,
    template_state: taskPayload.template_state ?? null,
    template_event_date: taskPayload.template_event_date ?? null,
    template_lead_days: taskPayload.template_lead_days ?? null,
    template_defer_until: taskPayload.template_defer_until ?? null,
    template_prompt_pending: taskPayload.template_prompt_pending ? 1 : 0,
    assignee_user_id: taskPayload.assignee_user_id ?? null,
    assignee_label: taskPayload.assignee_label ?? null,
    tags: normalizedTags,
    start_at: taskPayload.start_at ?? null,
    due_at: taskPayload.due_at ?? null,
    completed_at: null,
    waiting_followup_at: taskPayload.waiting_followup_at ?? null,
    next_checkin_at: taskPayload.next_checkin_at ?? null,
    sort_order: sortOrder,
    task_type: taskPayload.task_type ?? 'task',
    created_at: now,
    updated_at: now
  });
  if (status === TaskStatus.WAITING && !localTask.next_checkin_at) {
    const waitingTask = applyWaitingFollowup({ ...localTask, status: TaskStatus.WAITING }, new Date());
    localTask = { ...localTask, next_checkin_at: waitingTask.next_checkin_at };
  }
  if (status === TaskStatus.DONE && !localTask.completed_at) {
    localTask = { ...localTask, completed_at: now };
  }
  upsertTask(localTask);
  queueLocalChange({
    entity_type: 'task',
    entity_id: localTask.id,
    action: 'create',
    payload: { ...taskPayload, id: localTask.id }
  });
  syncStatus.textContent = 'Offline changes pending';
  return localTask;
}

async function updateTaskRecord(id, patch) {
  if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'status')) {
    patch = { ...patch, status: normalizeTaskStatusValue(patch.status) };
  }
  if (patch.title !== undefined) {
    patch = { ...patch, title: normalizeTitleInput(patch.title) };
  }
  if (patch.type_label !== undefined) {
    patch = { ...patch, type_label: patch.type_label ? normalizeTitleInput(patch.type_label) : null };
  }
  if (patch.group_label !== undefined) {
    patch = { ...patch, group_label: patch.group_label ? normalizeTitleInput(patch.group_label) : null };
  }
  if (patch.assignee_user_id !== undefined) {
    patch = { ...patch, assignee_user_id: patch.assignee_user_id || null };
  }
  if (patch.assignee_label !== undefined) {
    patch = { ...patch, assignee_label: patch.assignee_label ? normalizeTitleInput(patch.assignee_label) : null };
  }
  if (patch.tags !== undefined) {
    patch = { ...patch, tags: normalizeTagList(patch.tags) };
  }
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.updateTask(id, patch);
      if (updated) {
        upsertTask(updated);
        appendCrudEvent({
          source: 'app',
          event: 'task_updated',
          entity_type: 'task',
          entity_id: id,
          data: { fields: Object.keys(patch ?? {}) }
        });
      }
      return updated;
    } catch {
      // fall back to local update
    }
  }
  const existing = state.tasks[id];
  if (!existing) return null;
  let next = { ...existing, ...patch, updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    const statusKind = getStatusKind(patch.status);
    if (statusKind === TaskStatus.WAITING) {
      if (patch.next_checkin_at) {
        next.next_checkin_at = patch.next_checkin_at;
      } else if (patch.waiting_followup_at) {
        next.next_checkin_at = patch.waiting_followup_at;
      } else {
        const waitingTask = applyWaitingFollowup({ ...next, status: TaskStatus.WAITING }, new Date());
        next.next_checkin_at = waitingTask.next_checkin_at;
      }
    }
    if (statusKind === TaskStatus.DONE && !next.completed_at) {
      next.completed_at = new Date().toISOString();
    }
    if (statusKind !== TaskStatus.DONE && !('completed_at' in patch)) {
      next.completed_at = null;
    }
  }
  upsertTask(next);
  queueLocalChange({
    entity_type: 'task',
    entity_id: id,
    action: 'update',
    payload: patch
  });
  syncStatus.textContent = 'Offline changes pending';
  return next;
}

async function reparentTaskRecord(id, newParentId) {
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.reparentTask(id, newParentId);
      if (updated) upsertTask(updated);
      return updated;
    } catch {
      // fall back to local reparent
    }
  }
  const tasks = Object.values(state.tasks ?? {});
  try {
    const nextTasks = reparentTasks(tasks, id, newParentId ?? null);
    state.tasks = Object.fromEntries(nextTasks.map(task => [task.id, normalizeTask(task)]));
    queueLocalChange({
      entity_type: 'task',
      entity_id: id,
      action: 'reparent',
      payload: { new_parent_id: newParentId ?? null }
    });
    syncStatus.textContent = 'Offline changes pending';
    return state.tasks[id];
  } catch {
    return null;
  }
}

async function deleteTaskRecord(id) {
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const result = await api.deleteTask(id);
      if (result?.ids?.length) {
        result.ids.forEach(taskId => delete state.tasks[taskId]);
      } else if (result?.deleted) {
        delete state.tasks[id];
      }
      if (result?.deleted) {
        appendCrudEvent({
          source: 'app',
          event: 'task_deleted',
          entity_type: 'task',
          entity_id: id
        });
      }
      return result;
    } catch {
      // fall back to local delete
    }
  }
  const descendants = getDescendants(id).map(task => task.id);
  const allIds = [id, ...descendants];
  allIds.forEach(taskId => delete state.tasks[taskId]);
  queueLocalChange({
    entity_type: 'task',
    entity_id: id,
    action: 'delete',
    payload: { id }
  });
  syncStatus.textContent = 'Offline changes pending';
  return { deleted: 1, ids: allIds };
}

async function createUserRecord(payload) {
  if (!state.workspace) return null;
  const displayName = normalizeTitleInput(payload?.display_name ?? payload?.name ?? '');
  if (!displayName) return null;
  const orgId = state.workspace.org_id ?? DEFAULT_ORG_ID;
  const created = await api.createUser({
    ...payload,
    display_name: displayName,
    org_id: orgId,
    workspace_id: state.workspace.id
  });
  if (created) {
    upsertUser(created);
    appendCrudEvent({
      source: 'app',
      event: 'user_created',
      entity_type: 'user',
      entity_id: created.id
    });
  }
  return created;
}

async function createWorkspaceMembershipRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createWorkspaceMembership({
    ...payload,
    workspace_id: state.workspace.id
  });
  if (created) {
    upsertWorkspaceMembership(created);
    appendCrudEvent({
      source: 'app',
      event: 'workspace_membership_created',
      entity_type: 'workspace_membership',
      entity_id: created.id
    });
  }
  return created;
}

async function updateWorkspaceMembershipRecord(id, patch) {
  const updated = await api.updateWorkspaceMembership(id, patch);
  if (updated) {
    upsertWorkspaceMembership(updated);
    appendCrudEvent({
      source: 'app',
      event: 'workspace_membership_updated',
      entity_type: 'workspace_membership',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function deleteWorkspaceMembershipRecord(id) {
  const result = await api.deleteWorkspaceMembership(id);
  if (result?.deleted) {
    state.workspaceMemberships = (state.workspaceMemberships ?? []).filter(item => item.id !== id);
    appendCrudEvent({
      source: 'app',
      event: 'workspace_membership_deleted',
      entity_type: 'workspace_membership',
      entity_id: id
    });
  }
  return result;
}

async function createProjectRecord(name, options = {}) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const projectKind = normalizeProjectKind(options.kind);
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createProject({
        name: trimmed,
        workspace_id: state.workspace.id,
        kind: projectKind
      });
      if (created) {
        upsertProject(created);
        appendCrudEvent({
          source: 'app',
          event: 'project_created',
          entity_type: 'project',
          entity_id: created.id
        });
      }
      return created;
    } catch {
      // fall back to local create
    }
  }
  const now = new Date().toISOString();
  const localProject = normalizeProject({
    id: createId(),
    workspace_id: state.workspace.id,
    name: trimmed,
    kind: projectKind,
    archived: 0,
    created_at: now,
    updated_at: now
  });
  upsertProject(localProject);
  queueLocalChange({
    entity_type: 'project',
    entity_id: localProject.id,
    action: 'create',
    payload: { ...localProject }
  });
  syncStatus.textContent = 'Offline changes pending';
  return localProject;
}

async function updateProjectRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.updateProject(id, patch);
      if (updated) {
        upsertProject(updated);
        appendCrudEvent({
          source: 'app',
          event: 'project_updated',
          entity_type: 'project',
          entity_id: id,
          data: { fields: Object.keys(patch ?? {}) }
        });
      }
      return updated;
    } catch {
      // fall back to local update
    }
  }
  const existing = (state.projects ?? []).find(project => project.id === id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    kind: patch.kind ?? existing.kind,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
    updated_at: new Date().toISOString()
  };
  upsertProject(next);
  queueLocalChange({
    entity_type: 'project',
    entity_id: id,
    action: 'update',
    payload: patch
  });
  syncStatus.textContent = 'Offline changes pending';
  return next;
}

async function deleteProjectRecord(id) {
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const result = await api.deleteProject(id);
      if (result?.deleted) {
        state.projects = (state.projects ?? []).filter(project => project.id !== id);
        Object.values(state.tasks ?? {}).forEach(task => {
          if (task.project_id === id) {
            task.project_id = null;
          }
        });
        appendCrudEvent({
          source: 'app',
          event: 'project_deleted',
          entity_type: 'project',
          entity_id: id
        });
      }
      return result;
    } catch {
      // fall back to local delete
    }
  }
  state.projects = (state.projects ?? []).filter(project => project.id !== id);
  Object.values(state.tasks ?? {}).forEach(task => {
    if (task.project_id === id) {
      task.project_id = null;
    }
  });
  queueLocalChange({
    entity_type: 'project',
    entity_id: id,
    action: 'delete',
    payload: {}
  });
  syncStatus.textContent = 'Offline changes pending';
  return { deleted: 1 };
}

async function createStatusRecord(label) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(label);
  if (!trimmed) return null;
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createStatus({ workspace_id: state.workspace.id, label: trimmed });
      if (created) {
        upsertStatus(created);
        appendCrudEvent({
          source: 'app',
          event: 'status_created',
          entity_type: 'status',
          entity_id: created.id
        });
      }
      return created;
    } catch {
      // fall back to local create
    }
  }
  const now = new Date().toISOString();
  const status = normalizeStatus({
    id: createId(),
    workspace_id: state.workspace.id,
    key: getNextStatusKey(trimmed),
    label: trimmed,
    kind: 'custom',
    sort_order: getNextStatusSortOrder(),
    kanban_visible: 1,
    created_at: now,
    updated_at: now
  });
  upsertStatus(status);
  queueLocalChange({
    entity_type: 'status',
    entity_id: status.id,
    action: 'create',
    payload: { ...status }
  });
  syncStatus.textContent = 'Offline changes pending';
  return status;
}

async function updateStatusRecord(id, patch) {
  if (patch.label !== undefined) {
    patch = { ...patch, label: normalizeTitleInput(patch.label) };
  }
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.updateStatus(id, patch);
      if (updated) {
        upsertStatus(updated);
        appendCrudEvent({
          source: 'app',
          event: 'status_updated',
          entity_type: 'status',
          entity_id: id,
          data: { fields: Object.keys(patch ?? {}) }
        });
      }
      return updated;
    } catch {
      // fall back to local update
    }
  }
  const existing = (state.statuses ?? []).find(status => status.id === id);
  if (!existing) return null;
  const next = {
    ...existing,
    label: patch.label !== undefined ? String(patch.label).trim() || existing.label : existing.label,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    kanban_visible: patch.kanban_visible !== undefined ? (patch.kanban_visible ? 1 : 0) : existing.kanban_visible,
    updated_at: new Date().toISOString()
  };
  upsertStatus(next);
  queueLocalChange({
    entity_type: 'status',
    entity_id: id,
    action: 'update',
    payload: patch
  });
  syncStatus.textContent = 'Offline changes pending';
  return next;
}

async function deleteStatusRecord(id) {
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const result = await api.deleteStatus(id);
      if (result?.deleted) {
        state.statuses = (state.statuses ?? []).filter(status => status.id !== id);
        appendCrudEvent({
          source: 'app',
          event: 'status_deleted',
          entity_type: 'status',
          entity_id: id
        });
      }
      return result;
    } catch {
      // fall back to local delete
    }
  }
  const existing = (state.statuses ?? []).find(status => status.id === id);
  if (!existing) return { deleted: 0 };
  if (existing.kind && existing.kind !== 'custom') {
    return { deleted: 0, error: 'protected' };
  }
  const fallbackKey = getFallbackActiveStatusKey();
  Object.values(state.tasks ?? {}).forEach(task => {
    if (task.status === existing.key) {
      task.status = fallbackKey;
      task.updated_at = new Date().toISOString();
    }
  });
  state.statuses = (state.statuses ?? []).filter(status => status.id !== id);
  queueLocalChange({
    entity_type: 'status',
    entity_id: id,
    action: 'delete',
    payload: {}
  });
  syncStatus.textContent = 'Offline changes pending';
  return { deleted: 1 };
}

async function createTaskTypeRecord(name) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const existing = (state.taskTypes ?? []).find(type => type.workspace_id === state.workspace.id && type.name === trimmed);
  if (existing) return existing;
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createTaskType({ workspace_id: state.workspace.id, name: trimmed });
      if (created) {
        upsertTaskType(created);
        appendCrudEvent({
          source: 'app',
          event: 'task_type_created',
          entity_type: 'task_type',
          entity_id: created.id
        });
      }
      return created;
    } catch {
      // fall back to local create
    }
  }
  const now = new Date().toISOString();
  const type = normalizeTaskType({
    id: createId(),
    workspace_id: state.workspace.id,
    name: trimmed,
    is_default: 0,
    archived: 0,
    created_at: now,
    updated_at: now
  });
  upsertTaskType(type);
  queueLocalChange({
    entity_type: 'task_type',
    entity_id: type.id,
    action: 'create',
    payload: { ...type }
  });
  syncStatus.textContent = 'Offline changes pending';
  return type;
}

async function updateTaskTypeRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.updateTaskType(id, patch);
      if (updated) {
        upsertTaskType(updated);
        appendCrudEvent({
          source: 'app',
          event: 'task_type_updated',
          entity_type: 'task_type',
          entity_id: id,
          data: { fields: Object.keys(patch ?? {}) }
        });
      }
      return updated;
    } catch {
      // fall back to local update
    }
  }
  const existing = (state.taskTypes ?? []).find(type => type.id === id);
  if (!existing) return null;
  const nextName = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!nextName) return null;
  const next = {
    ...existing,
    name: nextName,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
    updated_at: new Date().toISOString()
  };
  if (nextName !== existing.name) {
    Object.values(state.tasks ?? {}).forEach(task => {
      if (task.type_label === existing.name) {
        task.type_label = nextName;
      }
    });
  }
  upsertTaskType(next);
  queueLocalChange({
    entity_type: 'task_type',
    entity_id: id,
    action: 'update',
    payload: patch
  });
  syncStatus.textContent = 'Offline changes pending';
  return next;
}

async function deleteTaskTypeRecord(id) {
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const result = await api.deleteTaskType(id);
      if (result?.deleted) {
        state.taskTypes = (state.taskTypes ?? []).filter(type => type.id !== id);
        appendCrudEvent({
          source: 'app',
          event: 'task_type_deleted',
          entity_type: 'task_type',
          entity_id: id
        });
      }
      return result;
    } catch {
      // fall back to local delete
    }
  }
  const existing = (state.taskTypes ?? []).find(type => type.id === id);
  if (!existing) return { deleted: 0 };
  if (existing.is_default) {
    return { deleted: 0, error: 'protected' };
  }
  Object.values(state.tasks ?? {}).forEach(task => {
    if (task.type_label === existing.name) {
      task.type_label = null;
    }
  });
  state.taskTypes = (state.taskTypes ?? []).filter(type => type.id !== id);
  queueLocalChange({
    entity_type: 'task_type',
    entity_id: id,
    action: 'delete',
    payload: {}
  });
  syncStatus.textContent = 'Offline changes pending';
  return { deleted: 1 };
}

async function createNoticeRecord(payload) {
  if (!state.workspace) return null;
  const title = payload?.title !== undefined ? normalizeTitleInput(payload.title) : payload?.title;
  const created = await api.createNotice({ ...payload, title, workspace_id: state.workspace.id });
  if (created) {
    upsertNotice(created);
    appendCrudEvent({
      source: 'app',
      event: 'notice_created',
      entity_type: 'notice',
      entity_id: created.id
    });
  }
  return created;
}

function createScheduleCalendarRecord(payload = {}) {
  if (!state.workspace) return null;
  const name = normalizeTitleInput(payload.name ?? '');
  if (!name) return null;
  const existing = getScheduleCalendarsForWorkspace({ includeArchived: true })
    .find((calendar) => String(calendar.name).toLowerCase() === name.toLowerCase());
  if (existing) {
    return { ...existing, duplicate: true };
  }
  const now = nowIso();
  const maxSortOrder = Math.max(
    0,
    ...getScheduleCalendarsForWorkspace({ includeArchived: true })
      .map((calendar) => (Number.isFinite(calendar.sort_order) ? calendar.sort_order : 0))
  );
  const record = normalizeScheduleCalendar({
    id: createId(),
    workspace_id: state.workspace.id,
    name,
    color: payload.color ?? pickNextScheduleCalendarColor(),
    time_zone: payload.time_zone ?? getSchedulingDisplayTimeZone(),
    sort_order: maxSortOrder + 10,
    archived: 0,
    created_at: now,
    updated_at: now
  });
  state.scheduleCalendars = [...(state.scheduleCalendars ?? []), record];
  setActiveScheduleCalendarId(record.id);
  appendCrudEvent({
    source: 'app',
    event: 'schedule_calendar_created',
    entity_type: 'schedule_calendar',
    entity_id: record.id
  });
  return record;
}

function updateScheduleCalendarRecord(id, patch = {}) {
  const calendars = state.scheduleCalendars ?? [];
  const index = calendars.findIndex((calendar) => calendar.id === id);
  if (index < 0) return null;
  const current = normalizeScheduleCalendar(calendars[index]);
  const nextName = patch.name === undefined ? current.name : normalizeTitleInput(patch.name);
  if (!nextName) return null;
  const duplicate = getScheduleCalendarsForWorkspace({ includeArchived: true })
    .find((calendar) =>
      calendar.id !== id
      && String(calendar.name).toLowerCase() === String(nextName).toLowerCase()
    );
  if (duplicate) return { ...current, duplicate: true };
  const next = normalizeScheduleCalendar({
    ...current,
    ...patch,
    name: nextName,
    time_zone: patch.time_zone !== undefined
      ? normalizeTimeZone(patch.time_zone, current.time_zone)
      : current.time_zone,
    id: current.id,
    workspace_id: current.workspace_id,
    created_at: current.created_at ?? nowIso(),
    updated_at: nowIso()
  });
  calendars[index] = next;
  state.scheduleCalendars = [...calendars];
  appendCrudEvent({
    source: 'app',
    event: 'schedule_calendar_updated',
    entity_type: 'schedule_calendar',
    entity_id: id,
    data: { fields: Object.keys(patch ?? {}) }
  });
  return next;
}

function deleteScheduleCalendarRecord(id) {
  const calendars = getScheduleCalendarsForWorkspace();
  const existing = calendars.find((calendar) => calendar.id === id);
  if (!existing) return { deleted: 0 };
  if (calendars.length <= 1) {
    return { deleted: 0, error: 'last-calendar' };
  }
  const fallback = calendars.find((calendar) => calendar.id !== id) ?? null;
  let reassignedCount = 0;
  state.scheduleEvents = (state.scheduleEvents ?? []).map((event) => {
    const normalized = normalizeScheduleEvent(event);
    if (normalized.workspace_id !== state.workspace?.id) return normalized;
    if (normalized.calendar_id !== id) return normalized;
    reassignedCount += 1;
    return {
      ...normalized,
      calendar_id: fallback?.id ?? null,
      updated_at: nowIso()
    };
  });
  state.scheduleCalendars = (state.scheduleCalendars ?? [])
    .filter((calendar) => calendar.id !== id);
  state.ui = state.ui ?? {};
  state.ui.schedulingHiddenCalendarIds = getSchedulingHiddenCalendarIds().filter((calendarId) => calendarId !== id);
  if (state.ui.schedulingActiveCalendarId === id) {
    setActiveScheduleCalendarId(fallback?.id ?? null);
  }
  appendCrudEvent({
    source: 'app',
    event: 'schedule_calendar_deleted',
    entity_type: 'schedule_calendar',
    entity_id: id,
    data: { reassigned_events: reassignedCount, fallback_calendar_id: fallback?.id ?? null }
  });
  return { deleted: 1, reassignedCount };
}

function createScheduleEventTypeRecord(payload = {}) {
  if (!state.workspace) return null;
  const name = normalizeTitleInput(payload.name ?? '');
  if (!name) return null;
  const existing = getScheduleEventTypesForWorkspace({ includeArchived: true })
    .find((type) => String(type.name).toLowerCase() === name.toLowerCase());
  if (existing) return { ...existing, duplicate: true };
  const now = nowIso();
  const record = normalizeScheduleEventType({
    id: createId(),
    workspace_id: state.workspace.id,
    name,
    description_template: payload.description_template ?? '',
    default_color: payload.default_color ?? pickSchedulePaletteColor(name),
    archived: 0,
    created_at: now,
    updated_at: now
  });
  state.scheduleEventTypes = [...(state.scheduleEventTypes ?? []), record];
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_type_created',
    entity_type: 'schedule_event_type',
    entity_id: record.id
  });
  return record;
}

function updateScheduleEventTypeRecord(id, patch = {}) {
  const types = state.scheduleEventTypes ?? [];
  const index = types.findIndex((type) => type.id === id);
  if (index < 0) return null;
  const existing = normalizeScheduleEventType(types[index]);
  const nextName = patch.name !== undefined ? normalizeTitleInput(patch.name) : existing.name;
  if (!nextName) return null;
  const duplicate = getScheduleEventTypesForWorkspace({ includeArchived: true })
    .find((type) => type.id !== id && String(type.name).toLowerCase() === nextName.toLowerCase());
  if (duplicate) return { ...existing, duplicate: true };
  const next = normalizeScheduleEventType({
    ...existing,
    name: nextName,
    description_template: patch.description_template !== undefined
      ? String(patch.description_template ?? '')
      : existing.description_template,
    default_color: patch.default_color !== undefined
      ? (normalizeScheduleEventColor(patch.default_color) ?? existing.default_color)
      : existing.default_color,
    updated_at: nowIso()
  });
  types[index] = next;
  state.scheduleEventTypes = [...types];
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_type_updated',
    entity_type: 'schedule_event_type',
    entity_id: id,
    data: { fields: Object.keys(patch ?? {}) }
  });
  return next;
}

function deleteScheduleEventTypeRecord(id) {
  const existing = getScheduleEventTypeById(id, { includeArchived: true });
  if (!existing) return { deleted: 0 };
  const available = getScheduleEventTypesForWorkspace({ includeArchived: false });
  if (available.length <= 1) {
    return { deleted: 0, error: 'last-type' };
  }
  const fallback = available.find((type) => type.id !== id) ?? null;
  state.scheduleEvents = (state.scheduleEvents ?? []).map((event) => {
    const normalized = normalizeScheduleEvent(event);
    if (normalized.workspace_id !== state.workspace?.id) return normalized;
    if (normalized.event_type_id !== id) return normalized;
    return {
      ...normalized,
      event_type_id: fallback?.id ?? null,
      updated_at: nowIso()
    };
  });
  state.scheduleEventTypes = (state.scheduleEventTypes ?? [])
    .filter((type) => type.id !== id);
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_type_deleted',
    entity_type: 'schedule_event_type',
    entity_id: id,
    data: { fallback_type_id: fallback?.id ?? null }
  });
  return { deleted: 1 };
}

function createScheduleEventRecord(payload) {
  if (!state.workspace) return null;
  const now = nowIso();
  const organizerUserId = getAuthState().user?.id ?? null;
  const event = normalizeScheduleEvent({
    id: createId(),
    workspace_id: state.workspace.id,
    title: payload?.title,
    kind: payload?.kind,
    calendar_id: resolveScheduleCalendarId(payload?.calendar_id),
    event_type_id: resolveScheduleEventTypeId(payload?.event_type_id),
    color_override: normalizeScheduleEventColor(payload?.color_override),
    organizer_user_id: payload?.organizer_user_id ?? organizerUserId,
    attendee_user_ids: normalizeScheduleEventAttendeeUserIds(payload?.attendee_user_ids),
    start_at: payload?.start_at,
    end_at: payload?.end_at ?? null,
    all_day: payload?.all_day ? 1 : 0,
    notes: payload?.notes ?? '',
    reminder_offset_minutes: normalizeScheduleEventReminderOffsetMinutes(payload?.reminder_offset_minutes)
      ?? DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES,
    reminder_last_occurrence_at: payload?.reminder_last_occurrence_at ?? null,
    recurrence_interval: normalizeScheduleEventRecurrenceInterval(payload?.recurrence_interval),
    recurrence_unit: normalizeScheduleEventRecurrenceUnit(payload?.recurrence_unit),
    archived: 0,
    created_at: now,
    updated_at: now
  });
  state.scheduleEvents = [...(state.scheduleEvents ?? []), event];
  if (event.calendar_id) {
    setActiveScheduleCalendarId(event.calendar_id);
  }
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_created',
    entity_type: 'schedule_event',
    entity_id: event.id
  });
  return event;
}

function updateScheduleEventRecord(id, patch = {}) {
  const events = state.scheduleEvents ?? [];
  const index = events.findIndex(event => event.id === id);
  if (index < 0) return null;
  const current = normalizeScheduleEvent(events[index]);
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'calendar_id')) {
    nextPatch.calendar_id = resolveScheduleCalendarId(nextPatch.calendar_id);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'event_type_id')) {
    nextPatch.event_type_id = resolveScheduleEventTypeId(nextPatch.event_type_id);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'color_override')) {
    nextPatch.color_override = normalizeScheduleEventColor(nextPatch.color_override);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'attendee_user_ids')) {
    nextPatch.attendee_user_ids = normalizeScheduleEventAttendeeUserIds(nextPatch.attendee_user_ids);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'organizer_user_id')) {
    nextPatch.organizer_user_id = String(nextPatch.organizer_user_id ?? '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'reminder_offset_minutes')) {
    nextPatch.reminder_offset_minutes = normalizeScheduleEventReminderOffsetMinutes(nextPatch.reminder_offset_minutes);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'reminder_last_occurrence_at')) {
    nextPatch.reminder_last_occurrence_at = String(nextPatch.reminder_last_occurrence_at ?? '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'recurrence_interval')) {
    nextPatch.recurrence_interval = normalizeScheduleEventRecurrenceInterval(nextPatch.recurrence_interval);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'recurrence_unit')) {
    nextPatch.recurrence_unit = normalizeScheduleEventRecurrenceUnit(nextPatch.recurrence_unit);
  }
  const reminderResetFields = ['start_at', 'end_at', 'all_day', 'recurrence_interval', 'recurrence_unit', 'reminder_offset_minutes'];
  const shouldResetReminder = reminderResetFields.some((field) => Object.prototype.hasOwnProperty.call(nextPatch, field));
  if (shouldResetReminder && !Object.prototype.hasOwnProperty.call(nextPatch, 'reminder_last_occurrence_at')) {
    nextPatch.reminder_last_occurrence_at = null;
  }
  const next = normalizeScheduleEvent({
    ...current,
    ...nextPatch,
    id: current.id,
    workspace_id: current.workspace_id,
    created_at: current.created_at ?? nowIso(),
    updated_at: nowIso()
  });
  events[index] = next;
  state.scheduleEvents = [...events];
  if (next.calendar_id) {
    setActiveScheduleCalendarId(next.calendar_id);
  }
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_updated',
    entity_type: 'schedule_event',
    entity_id: id,
    data: { fields: Object.keys(nextPatch ?? {}) }
  });
  return next;
}

function deleteScheduleEventRecord(id) {
  const events = state.scheduleEvents ?? [];
  const existing = events.find(event => event.id === id);
  if (!existing) return { deleted: 0 };
  state.scheduleEvents = events.filter(event => event.id !== id);
  appendCrudEvent({
    source: 'app',
    event: 'schedule_event_deleted',
    entity_type: 'schedule_event',
    entity_id: id
  });
  return { deleted: 1 };
}

async function createNoticeTypeRecord(payload) {
  if (!state.workspace) return null;
  const label = payload?.label !== undefined ? normalizeTitleInput(payload.label) : payload?.label;
  const created = await api.createNoticeType({ ...payload, label, workspace_id: state.workspace.id });
  if (created) {
    upsertNoticeType(created);
    appendCrudEvent({
      source: 'app',
      event: 'notice_type_created',
      entity_type: 'notice_type',
      entity_id: created.id
    });
  }
  return created;
}

async function updateNoticeRecord(id, patch) {
  if (patch.title !== undefined) {
    patch = { ...patch, title: normalizeTitleInput(patch.title) };
  }
  const updated = await api.updateNotice(id, patch);
  if (updated) {
    upsertNotice(updated);
    appendCrudEvent({
      source: 'app',
      event: 'notice_updated',
      entity_type: 'notice',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function updateNoticeTypeRecord(id, patch) {
  if (patch.label !== undefined) {
    patch = { ...patch, label: normalizeTitleInput(patch.label) };
  }
  const updated = await api.updateNoticeType(id, patch);
  if (updated) {
    upsertNoticeType(updated);
    appendCrudEvent({
      source: 'app',
      event: 'notice_type_updated',
      entity_type: 'notice_type',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function deleteNoticeRecord(id) {
  const result = await api.deleteNotice(id);
  if (result?.deleted) {
    state.notices = (state.notices ?? []).filter(notice => notice.id !== id);
    appendCrudEvent({
      source: 'app',
      event: 'notice_deleted',
      entity_type: 'notice',
      entity_id: id
    });
  }
  return result;
}

async function deleteNoticeTypeRecord(id) {
  const result = await api.deleteNoticeType(id);
  if (result?.deleted) {
    state.noticeTypes = (state.noticeTypes ?? []).filter(type => type.id !== id);
    appendCrudEvent({
      source: 'app',
      event: 'notice_type_deleted',
      entity_type: 'notice_type',
      entity_id: id
    });
  }
  return result;
}

async function createStoreRuleRecord(payload) {
  if (!state.workspace) return null;
  const storeName = payload?.store_name !== undefined ? normalizeTitleInput(payload.store_name) : payload?.store_name;
  const created = await api.createStoreRule({ ...payload, store_name: storeName, workspace_id: state.workspace.id });
  if (created) {
    upsertStoreRule(created);
    appendCrudEvent({
      source: 'app',
      event: 'store_rule_created',
      entity_type: 'store_rule',
      entity_id: created.id
    });
  }
  return created;
}

async function updateStoreRuleRecord(id, patch) {
  if (patch.store_name !== undefined) {
    patch = { ...patch, store_name: normalizeTitleInput(patch.store_name) };
  }
  const updated = await api.updateStoreRule(id, patch);
  if (updated) {
    upsertStoreRule(updated);
    appendCrudEvent({
      source: 'app',
      event: 'store_rule_updated',
      entity_type: 'store_rule',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function deleteStoreRuleRecord(id) {
  const result = await api.deleteStoreRule(id);
  if (result?.deleted) {
    state.storeRules = (state.storeRules ?? []).filter(rule => rule.id !== id);
    appendCrudEvent({
      source: 'app',
      event: 'store_rule_deleted',
      entity_type: 'store_rule',
      entity_id: id
    });
  }
  return result;
}

async function createShoppingListRecord(payload) {
  if (!state.workspace) return null;
  const name = payload?.name !== undefined ? normalizeTitleInput(payload.name) : payload?.name;
  const created = await api.createShoppingList({ ...payload, name, workspace_id: state.workspace.id });
  if (created) {
    upsertShoppingList(created);
    appendCrudEvent({
      source: 'app',
      event: 'shopping_list_created',
      entity_type: 'shopping_list',
      entity_id: created.id
    });
  }
  return created;
}

async function updateShoppingListRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const updated = await api.updateShoppingList(id, patch);
  if (updated) {
    upsertShoppingList(updated);
    appendCrudEvent({
      source: 'app',
      event: 'shopping_list_updated',
      entity_type: 'shopping_list',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function deleteShoppingListRecord(id) {
  const result = await api.deleteShoppingList(id);
  if (result?.deleted) {
    state.shoppingLists = (state.shoppingLists ?? []).filter(list => list.id !== id);
    removeShoppingItemsForList(id);
    if (getStoredShoppingInboxListId() === id) {
      setStoredShoppingInboxListId(null);
    }
    appendCrudEvent({
      source: 'app',
      event: 'shopping_list_deleted',
      entity_type: 'shopping_list',
      entity_id: id
    });
  }
  return result;
}

async function createShoppingItemsRecord(listId, items) {
  if (!items.length) return [];
  const normalizedItems = items.map(item => ({
    ...item,
    name: item.name !== undefined ? normalizeTitleInput(item.name) : item.name
  }));
  const result = await api.createShoppingItems(listId, normalizedItems);
  const createdItems = Array.isArray(result?.items) ? result.items : [];
  createdItems.forEach(item => upsertShoppingItem(item));
  const targetList = getShoppingListsForWorkspace({ includeArchived: true }).find((list) => list.id === listId);
  const targetStoreName = getStoreNameFromShoppingList(targetList);
  if (targetStoreName && !isShoppingInboxList(targetList) && createdItems.length) {
    const names = createdItems.map((item) => item.name).filter(Boolean);
    if (names.length) {
      void learnStoreRuleFromItemNames(targetStoreName, names);
    }
  }
  if (createdItems.length) {
    appendCrudEvent({
      source: 'app',
      event: 'shopping_items_created',
      entity_type: 'shopping_list',
      entity_id: listId,
      data: { count: createdItems.length }
    });
  }
  return createdItems;
}

async function updateShoppingItemRecord(id, patch) {
  if (patch.name !== undefined) {
    patch = { ...patch, name: normalizeTitleInput(patch.name) };
  }
  const updated = await api.updateShoppingItem(id, patch);
  if (updated) {
    upsertShoppingItem(updated);
    appendCrudEvent({
      source: 'app',
      event: 'shopping_item_updated',
      entity_type: 'shopping_item',
      entity_id: id,
      data: { fields: Object.keys(patch ?? {}) }
    });
  }
  return updated;
}

async function deleteShoppingItemRecord(id) {
  const result = await api.deleteShoppingItem(id);
  if (result?.deleted) {
    delete state.shoppingItems[id];
    appendCrudEvent({
      source: 'app',
      event: 'shopping_item_deleted',
      entity_type: 'shopping_item',
      entity_id: id
    });
  }
  return result;
}

async function archiveShoppingListRecord(listId, options = {}) {
  const { skipFallbackView = false } = options;
  const updated = await updateShoppingListRecord(listId, { archived: 1 });
  if (!updated) return null;
  if (state.ui?.activeShoppingListId === listId) {
    const next = (state.shoppingLists ?? []).find(list => list.id !== listId && !list.archived);
    state.ui.activeShoppingListId = next?.id ?? null;
    if (!next && !skipFallbackView) {
      setActiveView('tasks');
    }
  }
  return updated;
}

async function maybeArchiveCompletedShoppingListOnExit() {
  const listId = state.ui?.activeShoppingListId;
  if (!listId) return;
  const list = (state.shoppingLists ?? []).find(item => item.id === listId);
  if (!list || list.archived) return;
  if (isShoppingInboxList(list)) return;
  if (!isShoppingListComplete(listId)) return;
  try {
    await archiveShoppingListRecord(listId, { skipFallbackView: true });
    render();
  } catch {
    // Keep current state if archiving fails (e.g., API unavailable).
  }
}

function parseShoppingItems(input) {
  if (!input) return [];
  const lines = input
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
  const hasBullets = lines.some(line => /^[-*]\s*/.test(line));
  let raw;
  if (hasBullets) {
    const startIndex = lines.length && !/^[-*]\s*/.test(lines[0]) ? 1 : 0;
    raw = lines.slice(startIndex)
      .map(line => line.replace(/^[-*]\s*\[[ xX]\]\s*/, ''))
      .map(line => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean);
  } else {
    raw = input
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return raw.map(item => {
    let value = item.replace(/\s+/g, ' ');
    value = value.replace(/\b(k\s*cups|k-cups)\b/gi, 'K-cups');
    value = value.charAt(0).toUpperCase() + value.slice(1);
    return value;
  });
}

function normalizeShoppingItems(input) {
  return parseShoppingItems(input).join('\n');
}

function parseShoppingListInput(input) {
  const lines = input
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) return { title: null, items: [] };
  const hasBullets = lines.some(line => /^[-*]\s*/.test(line));
  if (!hasBullets) {
    return { title: null, items: parseShoppingItems(input) };
  }
  const title = /^[-*]\s*/.test(lines[0]) ? null : lines[0];
  const startIndex = title ? 1 : 0;
  const items = lines.slice(startIndex)
    .map(line => line.replace(/^[-*]\s*\[[ xX]\]\s*/, ''))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
  return { title, items: parseShoppingItems(items.join('\n')) };
}

function formatShortDate(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

function formatShortDateFromInput(value) {
  if (!value) return formatShortDate();
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return formatShortDate();
  return formatShortDate(date);
}

function formatFollowupMeta(task) {
  const followup = task?.waiting_followup_at ?? task?.next_checkin_at ?? null;
  if (!followup) return 'follow-up unscheduled';
  const date = new Date(followup);
  if (Number.isNaN(date.getTime())) return 'follow-up unscheduled';
  const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const overdue = date.getTime() < Date.now();
  return `follow-up ${label}${overdue ? ' (overdue)' : ''}`;
}

function getNotesContent() {
  if (notesMode === 'markdown' || !notesEditorView || !notesMarkdownSerializer) {
    return editorDesc?.value ?? '';
  }
  return notesMarkdownSerializer.serialize(notesEditorView.state.doc);
}

function setNotesContent(value = '') {
  pendingNotesContent = value ?? '';
  if (editorDesc) editorDesc.value = pendingNotesContent;
  if (notesEditorView && notesMarkdownParser) {
    updateNotesEditorDoc(pendingNotesContent);
  }
  if (notesMode === 'rich') {
    setNotesDisplayMode(true);
  }
}

function createNotesDocFromMarkdown(markdown) {
  if (!notesMarkdownParser || !notesSchema) return null;
  const source = markdown ?? '';
  if (!source.trim()) {
    const paragraph = notesSchema.nodes.paragraph?.create();
    return notesSchema.topNodeType.createAndFill(null, paragraph ? [paragraph] : null);
  }
  try {
    return notesMarkdownParser.parse(source);
  } catch {
    const paragraph = notesSchema.nodes.paragraph?.create();
    return notesSchema.topNodeType.createAndFill(null, paragraph ? [paragraph] : null);
  }
}

function updateNotesEditorDoc(markdown) {
  if (!notesEditorView || !notesEditorStateCtor || !notesSchema) return;
  const doc = createNotesDocFromMarkdown(markdown);
  if (!doc) return;
  const nextState = notesEditorStateCtor.create({
    schema: notesSchema,
    doc,
    plugins: notesEditorPlugins
  });
  notesEditorView.updateState(nextState);
}

function isNotesCommandAvailable(command) {
  if (!notesSchema) return false;
  switch (command) {
    case 'heading':
      return Boolean(notesSchema.nodes.heading);
    case 'bold':
      return Boolean(notesSchema.marks.strong);
    case 'italic':
      return Boolean(notesSchema.marks.em);
    case 'bullet':
      return Boolean(notesSchema.nodes.bullet_list);
    case 'ordered':
      return Boolean(notesSchema.nodes.ordered_list);
    case 'quote':
      return Boolean(notesSchema.nodes.blockquote);
    case 'code':
      return Boolean(notesSchema.marks.code);
    case 'codeblock':
      return Boolean(notesSchema.nodes.code_block);
    case 'link':
      return Boolean(notesSchema.marks.link);
    default:
      return false;
  }
}

function updateNotesToolbarState() {
  notesModeButtons.forEach(button => {
    const isActive = button.dataset.mode === notesMode;
    button.classList.toggle('is-active', isActive);
  });
  notesFormatButtons.forEach(button => {
    const command = button.dataset.command;
    const available = isNotesCommandAvailable(command);
    button.disabled = !available || notesMode === 'markdown' || !notesEditorView || notesDisplayMode;
  });
}

function setNotesDisplayMode(nextMode) {
  const next = notesMode === 'markdown' ? false : Boolean(nextMode);
  notesDisplayMode = next;
  if (notesEditorWrapper) {
    notesEditorWrapper.classList.toggle('is-display', notesDisplayMode);
  }
  if (notesEditorView) {
    notesEditorView.setProps({
      editable: () => !notesDisplayMode && notesMode === 'rich'
    });
  }
  updateNotesToolbarState();
}

function setNotesMode(mode) {
  const nextMode = mode === 'markdown' ? 'markdown' : 'rich';
  if (!notesEditorView && nextMode === 'rich') {
    notesMode = 'markdown';
  } else {
    notesMode = nextMode;
  }
  if (notesEditorWrapper) {
    notesEditorWrapper.classList.toggle('is-markdown', notesMode === 'markdown');
    notesEditorWrapper.classList.toggle('is-rich', notesMode !== 'markdown');
  }
  if (notesMode === 'markdown' && notesEditorView && notesMarkdownSerializer && editorDesc) {
    editorDesc.value = notesMarkdownSerializer.serialize(notesEditorView.state.doc);
  }
  if (notesMode !== 'markdown' && notesEditorView && notesMarkdownParser) {
    updateNotesEditorDoc(editorDesc?.value ?? '');
    if (!notesDisplayMode) {
      notesEditorView.focus();
    }
  }
  setNotesDisplayMode(notesMode !== 'markdown' ? notesDisplayMode : false);
  updateNotesToolbarState();
}

function buildTaskEditorPatch(task) {
  if (!task) return { patch: null, parentChanged: false };
  const titleInput = editorTitle?.value.trim() ?? '';
  const title = titleInput || task.title;
  const nextStatus = normalizeTaskStatusValue(editorStatus?.value ?? task.status ?? '');
  const nextParentId = editorParent?.value || null;
  const description = getNotesContent();
  const typeLabel = editorType?.value ? editorType.value.trim() : null;
  const tags = normalizeTagList(editorTags?.value ?? '');
  const recurrence = editorRecurrence ?? { interval: null, unit: null };
  const reminderValue = parseInt(editorReminder?.value ?? '', 10);
  const reminder = Number.isFinite(reminderValue) ? reminderValue : null;
  const startAt = editorStart ? fromDatetimeLocal(editorStart.value) : null;
  const dueAt = fromDatetimeLocal(editorDue?.value ?? '');
  const canEditProject = Boolean(editorProject);
  const projectId = canEditProject ? (editorProject?.value || null) : (task.project_id ?? null);
  const priority = editorPriority?.value ?? task.priority ?? 'medium';
  const assigneeSelection = editorAssignee?.value ?? ASSIGNEE_SELECT_NONE;
  const assigneeLabelInput = editorAssigneeLabel?.value?.trim() ?? '';
  const nextAssigneeUserId = assigneeSelection && assigneeSelection !== ASSIGNEE_SELECT_EXTERNAL
    ? assigneeSelection
    : null;
  const nextAssigneeLabel = assigneeSelection === ASSIGNEE_SELECT_EXTERNAL ? assigneeLabelInput : null;

  const patch = {};
  if (title && title !== task.title) patch.title = title;
  if (description !== (task.description_md ?? '')) patch.description_md = description;
  if ((typeLabel ?? null) !== (task.type_label ?? null)) patch.type_label = typeLabel;
  if (!areTagListsEqual(tags, task.tags ?? [])) patch.tags = tags;
  if (priority !== (task.priority ?? 'medium')) patch.priority = priority;
  if (canEditProject && (projectId ?? null) !== (task.project_id ?? null)) patch.project_id = projectId;
  if ((nextAssigneeUserId ?? null) !== (task.assignee_user_id ?? null)) {
    patch.assignee_user_id = nextAssigneeUserId;
  }
  if ((nextAssigneeLabel ?? null) !== (task.assignee_label ?? null)) {
    patch.assignee_label = nextAssigneeLabel;
  }
  if ((recurrence.interval ?? null) !== (task.recurrence_interval ?? null)) {
    patch.recurrence_interval = recurrence.interval ?? null;
  }
  const nextRecurrenceUnit = recurrence.interval ? recurrence.unit : null;
  if ((nextRecurrenceUnit ?? null) !== (task.recurrence_unit ?? null)) {
    patch.recurrence_unit = nextRecurrenceUnit ?? null;
  }
  if ((reminder ?? null) !== (task.reminder_offset_days ?? null)) patch.reminder_offset_days = reminder;
  if (editorStart && (startAt ?? null) !== (task.start_at ?? null)) patch.start_at = startAt;
  if ((dueAt ?? null) !== (task.due_at ?? null)) patch.due_at = dueAt;
  if (nextStatus !== normalizeTaskStatusValue(task.status)) patch.status = nextStatus;

  const wasWaiting = isWaitingStatusKey(normalizeTaskStatusValue(task.status));
  if (isWaitingStatusKey(nextStatus)) {
    const followupAt = fromDatetimeLocal(editorFollowup?.value ?? '');
    patch.waiting_followup_at = followupAt;
    if (followupAt) {
      patch.next_checkin_at = followupAt;
    } else {
      const withFollowup = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date());
      patch.next_checkin_at = withFollowup.next_checkin_at;
    }
  } else if (wasWaiting) {
    patch.waiting_followup_at = null;
    if (task.waiting_followup_at && task.next_checkin_at === task.waiting_followup_at) {
      patch.next_checkin_at = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    if (isDoneStatusKey(nextStatus)) {
      patch.completed_at = task.completed_at ?? nowIso();
    } else {
      patch.completed_at = null;
    }
  }

  const parentChanged = (task.parent_id ?? null) !== (nextParentId ?? null);
  if (parentChanged) {
    patch.sort_order = getNextTaskSortOrder(nextParentId, nextParentId ? null : nextStatus);
  }

  if (!Object.keys(patch).length && !parentChanged) {
    return { patch: null, parentChanged: false };
  }
  return { patch, parentChanged, nextParentId, nextStatus };
}

async function performTaskEditorAutosave(options = {}) {
  const { force = false, taskId = activeTaskId } = options;
  if (!taskId) return;
  if (!force && !taskEditor?.classList.contains('is-open')) return;
  if (taskEditorAutosaveInFlight) {
    taskEditorAutosaveQueued = true;
    return;
  }
  taskEditorAutosaveInFlight = true;
  try {
    const task = state.tasks[taskId];
    if (!task) return;
    const { patch, parentChanged, nextParentId, nextStatus } = buildTaskEditorPatch(task);
    if (!patch && !parentChanged) return;
    if (parentChanged) {
      try {
        await reparentTaskRecord(task.id, nextParentId);
      } catch (err) {
        alert(err?.message ?? 'Unable to move task.');
        return;
      }
    }
    if (patch) {
      const updated = await updateTaskRecord(task.id, patch);
      const statusChanged = patch.status && patch.status !== task.status;
      if (statusChanged && isDoneStatusKey(nextStatus)) {
        await maybeCreateRecurringTask(updated ?? state.tasks[task.id]);
        await maybePromptCompleteParent(task.id);
      }
    }
    if (!taskEditor?.contains(document.activeElement)) {
      render();
    }
  } finally {
    taskEditorAutosaveInFlight = false;
    if (taskEditorAutosaveQueued) {
      taskEditorAutosaveQueued = false;
      scheduleTaskEditorAutosave('queued', 200);
    }
  }
}

function scheduleTaskEditorAutosave(reason = 'change', delay = 600) {
  if (!activeTaskId || !taskEditor?.classList.contains('is-open')) return;
  if (isPopulatingTaskEditor) return;
  if (taskEditorAutosaveTimer) {
    clearTimeout(taskEditorAutosaveTimer);
  }
  taskEditorAutosaveTimer = setTimeout(() => {
    taskEditorAutosaveTimer = null;
    performTaskEditorAutosave();
  }, delay);
}

function updateTaskEditorScrollbar() {
  if (!taskEditorBody || !taskEditorScrollbar || !taskEditorScrollThumb) return;
  const scrollHeight = taskEditorBody.scrollHeight;
  const clientHeight = taskEditorBody.clientHeight;
  if (scrollHeight <= clientHeight + 1) {
    taskEditorScrollbar.classList.add('hidden');
    return;
  }
  taskEditorScrollbar.classList.remove('hidden');
  const trackHeight = taskEditorBody.clientHeight;
  const maxScroll = scrollHeight - clientHeight;
  const thumbHeight = Math.max(80, (clientHeight / scrollHeight) * trackHeight);
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const ratio = maxScroll ? taskEditorBody.scrollTop / maxScroll : 0;
  const thumbTop = maxThumbTop * ratio;
  taskEditorScrollThumb.style.height = `${thumbHeight}px`;
  taskEditorScrollThumb.style.transform = `translateY(${thumbTop}px)`;
}

function getSelectedTaskIds() {
  return Array.isArray(state.ui?.selectedTaskIds) ? state.ui.selectedTaskIds : [];
}

function setSelectedTaskIds(ids) {
  state.ui = state.ui ?? {};
  const validIds = (ids ?? []).filter(id => state.tasks?.[id]);
  state.ui.selectedTaskIds = Array.from(new Set(validIds));
  render();
}

function clearSelectedTasks() {
  setSelectedTaskIds([]);
}

function isTaskSelected(taskId) {
  return getSelectedTaskIds().includes(taskId);
}

function renderBulkSelectionBar() {
  const selected = getSelectedTaskIds();
  taskTreeEl?.classList.toggle('task-selection-active', selected.length > 0);
  if (!taskBulkBar || !taskBulkCount) return;
  if (!selected.length) {
    taskBulkBar.classList.add('hidden');
    return;
  }
  taskBulkCount.textContent = `${selected.length} selected`;
  taskBulkBar.classList.remove('hidden');
  if (taskBulkEditBtn) taskBulkEditBtn.disabled = false;
  if (taskBulkDeleteBtn) taskBulkDeleteBtn.disabled = false;
  if (taskBulkClearBtn) taskBulkClearBtn.disabled = false;
  renderBulkUndoMenu();
}

function getBulkUndoStack() {
  return Array.isArray(state.ui?.bulkUndoStack) ? state.ui.bulkUndoStack : [];
}

function pushBulkUndo(entry) {
  state.ui = state.ui ?? {};
  const stack = getBulkUndoStack();
  const next = [entry, ...stack];
  state.ui.bulkUndoStack = next.slice(0, 50);
  renderBulkUndoMenu();
}

function removeBulkUndoEntry(entryId) {
  state.ui = state.ui ?? {};
  state.ui.bulkUndoStack = getBulkUndoStack().filter(entry => entry.id !== entryId);
  renderBulkUndoMenu();
}

function renderBulkUndoMenu() {
  if (!taskBulkUndoMenu) return;
  const stack = getBulkUndoStack();
  taskBulkUndoMenu.innerHTML = '';
  if (!stack.length) {
    const empty = document.createElement('div');
    empty.className = 'workspace-menu-item';
    empty.textContent = 'No bulk history';
    empty.disabled = true;
    taskBulkUndoMenu.appendChild(empty);
    return;
  }
  stack.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-menu-item';
    const timestamp = entry.created_at ? new Date(entry.created_at) : null;
    const timeLabel = timestamp && !Number.isNaN(timestamp.getTime())
      ? ` · ${timestamp.toLocaleString()}`
      : '';
    button.textContent = `${entry.label}${timeLabel}`;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await undoBulkAction(entry.id);
      taskBulkUndoMenu.classList.add('hidden');
      openMenu = null;
    });
    taskBulkUndoMenu.appendChild(button);
  });
}

async function undoBulkAction(entryId) {
  const stack = getBulkUndoStack();
  const entry = stack.find(item => item.id === entryId);
  if (!entry) return;
  if (entry.kind === 'edit') {
    for (const snapshot of entry.tasks) {
      if (!state.tasks[snapshot.id]) continue;
      await updateTaskRecord(snapshot.id, snapshot.before);
    }
  } else if (entry.kind === 'delete') {
    await restoreTasksFromSnapshots(entry.tasks);
  }
  removeBulkUndoEntry(entryId);
  render();
}

let notesToolbarBound = false;

function bindNotesToolbar(commands) {
  if (notesToolbarBound || !notesEditorWrapper) return;
  notesToolbarBound = true;
  const { toggleMark, setBlockType, wrapIn, wrapInList, lift } = commands;

  editorNotesContainer?.addEventListener('mousedown', (event) => {
    if (notesMode !== 'rich' || !notesDisplayMode) return;
    if (event.button !== 0) return;
    notesPointerDown = true;
    notesPointerMoved = false;
    notesPointerStart = { x: event.clientX, y: event.clientY };
  });

  editorNotesContainer?.addEventListener('mousemove', (event) => {
    if (!notesPointerDown) return;
    const deltaX = Math.abs(event.clientX - notesPointerStart.x);
    const deltaY = Math.abs(event.clientY - notesPointerStart.y);
    if (deltaX > 4 || deltaY > 4) {
      notesPointerMoved = true;
    }
  });

  document.addEventListener('mouseup', (event) => {
    if (!notesPointerDown) return;
    notesPointerDown = false;
    if (notesMode !== 'rich' || !notesDisplayMode) return;
    const target = event.target;
    if (target instanceof Element && target.closest('a')) return;
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
    if (notesPointerMoved || hasSelection) return;
    if (target instanceof Element && target.closest('#editor-notes')) {
      setNotesDisplayMode(false);
      setTimeout(() => {
        notesEditorView?.focus();
      }, 0);
    }
  });

  notesModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode || 'rich';
      if (mode === 'markdown') {
        setNotesMode(notesMode === 'markdown' ? 'rich' : 'markdown');
        return;
      }
      setNotesMode(mode);
    });
  });

  notesFormatButtons.forEach(button => {
    const command = button.dataset.command;
    const level = Number(button.dataset.level || 0);
    button.addEventListener('click', () => {
      if (notesMode === 'markdown' || !notesEditorView) return;
      if (!isNotesCommandAvailable(command)) return;
      const { state, dispatch } = notesEditorView;
      let executed = false;
      switch (command) {
        case 'heading': {
          const node = notesSchema.nodes.heading;
          const paragraph = notesSchema.nodes.paragraph;
          if (!node) break;
          const nextLevel = Number.isFinite(level) && level > 0 ? level : 1;
          const { $from, $to } = state.selection;
          const isHeading = $from.parent.type === node
            && $to.parent.type === node
            && $from.parent.attrs.level === nextLevel
            && $to.parent.attrs.level === nextLevel;
          if (isHeading && paragraph) {
            executed = setBlockType(paragraph)(state, dispatch);
          } else {
            executed = setBlockType(node, { level: nextLevel })(state, dispatch);
          }
          break;
        }
        case 'bold': {
          const mark = notesSchema.marks.strong;
          executed = toggleMark(mark)(state, dispatch);
          break;
        }
        case 'italic': {
          const mark = notesSchema.marks.em;
          executed = toggleMark(mark)(state, dispatch);
          break;
        }
        case 'bullet': {
          const node = notesSchema.nodes.bullet_list;
          executed = wrapInList(node)(state, dispatch);
          break;
        }
        case 'ordered': {
          const node = notesSchema.nodes.ordered_list;
          executed = wrapInList(node)(state, dispatch);
          break;
        }
        case 'quote': {
          const node = notesSchema.nodes.blockquote;
          if (node) {
            const hasBlockquote = (selection) => {
              const { $from, $to } = selection;
              for (let depth = $from.depth; depth > 0; depth -= 1) {
                if ($from.node(depth).type === node) {
                  for (let otherDepth = $to.depth; otherDepth > 0; otherDepth -= 1) {
                    if ($to.node(otherDepth).type === node) {
                      return true;
                    }
                  }
                  return false;
                }
              }
              return false;
            };
            if (hasBlockquote(state.selection)) {
              executed = lift(state, dispatch);
            } else {
              executed = wrapIn(node)(state, dispatch);
            }
          }
          break;
        }
        case 'code': {
          const mark = notesSchema.marks.code;
          executed = toggleMark(mark)(state, dispatch);
          break;
        }
        case 'codeblock': {
          const node = notesSchema.nodes.code_block;
          executed = setBlockType(node)(state, dispatch);
          break;
        }
        case 'link': {
          const mark = notesSchema.marks.link;
          if (!mark) break;
          const { from, to } = state.selection;
          const hasLink = state.doc.rangeHasMark(from, to, mark);
          if (hasLink) {
            executed = toggleMark(mark)(state, dispatch);
          } else {
            const href = prompt('Link URL');
            if (!href) break;
            executed = toggleMark(mark, { href })(state, dispatch);
          }
          break;
        }
        default:
          break;
      }
      if (executed) {
        notesEditorView.focus();
      }
    });
  });
}

async function initNotesEditor() {
  if (!editorNotesContainer || !notesEditorWrapper) return;
  if (notesEditorInitPromise) return notesEditorInitPromise;
  notesEditorInitPromise = (async () => {
    try {
      const [
        statePkg,
        viewPkg,
        markdownPkg,
        keymapPkg,
        historyPkg,
        commandsPkg,
        listPkg
      ] = await Promise.all([
        import('https://esm.sh/prosemirror-state@1.4.3'),
        import('https://esm.sh/prosemirror-view@1.35.0'),
        import('https://esm.sh/prosemirror-markdown@1.10.0'),
        import('https://esm.sh/prosemirror-keymap@1.2.2'),
        import('https://esm.sh/prosemirror-history@1.3.0'),
        import('https://esm.sh/prosemirror-commands@1.6.2'),
        import('https://esm.sh/prosemirror-schema-list@1.3.0')
      ]);

      const { EditorState, Plugin, PluginKey } = statePkg;
      const { EditorView } = viewPkg;
      const { schema, defaultMarkdownParser, defaultMarkdownSerializer } = markdownPkg;
      const { keymap } = keymapPkg;
      const { history, undo, redo } = historyPkg;
      const { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, lift } = commandsPkg;
      const { wrapInList, liftListItem, sinkListItem, splitListItem } = listPkg;

      notesEditorStateCtor = EditorState;
      notesSchema = schema;
      notesMarkdownParser = defaultMarkdownParser;
      notesMarkdownSerializer = defaultMarkdownSerializer;

      const keyBindings = {
        ...baseKeymap,
        'Mod-z': undo,
        'Shift-Mod-z': redo,
        'Mod-y': redo,
        'Mod-b': toggleMark(notesSchema.marks.strong),
        'Mod-i': toggleMark(notesSchema.marks.em),
        'Mod-`': toggleMark(notesSchema.marks.code)
      };

      if (notesSchema.nodes.list_item) {
        const listItem = notesSchema.nodes.list_item;
        keyBindings.Tab = sinkListItem(listItem);
        keyBindings['Shift-Tab'] = liftListItem(listItem);
        keyBindings.Enter = chainCommands(splitListItem(listItem), baseKeymap.Enter);
      }

      const plugins = [
        new Plugin({
          key: new PluginKey('notes-default-paragraph'),
          appendTransaction(transactions, oldState, newState) {
            if (!transactions.some(tr => tr.docChanged)) return null;
            if (oldState.doc.textContent.trim()) return null;
            if (newState.doc.childCount !== 1) return null;
            const first = newState.doc.firstChild;
            if (!first) return null;
            if (!newState.schema.nodes.heading || !newState.schema.nodes.paragraph) return null;
            if (first.type !== newState.schema.nodes.heading) return null;
            const replacement = newState.schema.nodes.paragraph.create(null, first.content);
            return newState.tr.replaceWith(0, newState.doc.content.size, replacement);
          }
        }),
        new Plugin({
          key: new PluginKey('notes-autosave'),
          view() {
            return {
              update(view, prevState) {
                if (notesMode === 'markdown') return;
                if (prevState.doc.eq(view.state.doc)) return;
                scheduleTaskEditorAutosave('notes', 700);
              }
            };
          }
        }),
        history(),
        keymap(keyBindings)
      ];

      notesEditorPlugins = plugins;

      const markdown = editorDesc?.value ?? pendingNotesContent ?? '';
      const doc = createNotesDocFromMarkdown(markdown) ?? notesSchema.topNodeType.createAndFill();
      const state = EditorState.create({
        schema: notesSchema,
        doc,
        plugins
      });
      notesEditorView = new EditorView(editorNotesContainer, {
        state,
        handleDOMEvents: {
          click(view, event) {
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const link = target.closest('a');
            if (!link) return false;
            event.preventDefault();
            const href = link.getAttribute('href');
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer');
            }
            return true;
          }
        }
      });

      bindNotesToolbar({ toggleMark, setBlockType, wrapIn, wrapInList, lift });
      setNotesMode(notesMode || 'rich');
      setNotesDisplayMode(notesMode !== 'markdown');
      setNotesContent(markdown);
    } catch (err) {
      console.warn('Notes editor failed to load', err);
      notesEditorView = null;
      notesMarkdownParser = null;
      notesMarkdownSerializer = null;
      notesSchema = null;
      notesEditorPlugins = [];
      notesMode = 'markdown';
      if (notesEditorWrapper) {
        notesEditorWrapper.classList.remove('is-rich');
        notesEditorWrapper.classList.add('is-markdown');
      }
      updateNotesToolbarState();
    }
  })();
  return notesEditorInitPromise;
}

function parseStoreAndDateFromTitle(title) {
  if (!title) return { store: null, date: null };
  const match = title.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!match) {
    return { store: title.trim() || null, date: null };
  }
  const [, rawMonth, rawDay, rawYear] = match;
  const month = rawMonth.padStart(2, '0');
  const day = rawDay.padStart(2, '0');
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const date = `${year}-${month}-${day}`;
  const store = title.replace(match[0], '').trim() || null;
  return { store, date };
}

function titleHasDate(title) {
  if (!title) return false;
  return /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(title);
}

function ensureDateInTitle(title) {
  if (!title) return title;
  if (titleHasDate(title)) return title;
  return `${title} ${formatShortDate()}`;
}

function getShoppingListsForWorkspace({ includeArchived = true } = {}) {
  if (!state.workspace) return [];
  return (state.shoppingLists ?? [])
    .filter((list) => list.workspace_id === state.workspace.id)
    .filter((list) => includeArchived || !list.archived);
}

function getStoredShoppingInboxListId() {
  return state.ui?.shoppingInboxListId ?? null;
}

function setStoredShoppingInboxListId(listId) {
  state.ui = state.ui ?? {};
  state.ui.shoppingInboxListId = listId ? String(listId) : null;
}

function isShoppingInboxList(list) {
  if (!list || !state.workspace || list.workspace_id !== state.workspace.id) return false;
  if (list.archived) return false;
  const storedId = getStoredShoppingInboxListId();
  if (storedId && list.id === storedId) return true;
  return String(list.name ?? '').trim().toLowerCase() === SHOPPING_INBOX_NAME.toLowerCase();
}

function isShoppingInboxListId(listId) {
  if (!listId) return false;
  const list = getShoppingListsForWorkspace({ includeArchived: true })
    .find((candidate) => candidate.id === listId);
  return isShoppingInboxList(list);
}

function getShoppingInboxList() {
  const lists = getShoppingListsForWorkspace({ includeArchived: false });
  const storedId = getStoredShoppingInboxListId();
  if (storedId) {
    const byId = lists.find((list) => list.id === storedId);
    if (byId) return byId;
  }
  const byName = lists.find((list) => String(list.name ?? '').trim().toLowerCase() === SHOPPING_INBOX_NAME.toLowerCase());
  if (byName) {
    setStoredShoppingInboxListId(byName.id);
    return byName;
  }
  return null;
}

async function ensureShoppingInboxListRecord() {
  const existing = getShoppingInboxList();
  if (existing) return existing;
  const created = await createShoppingListRecord({ name: SHOPPING_INBOX_NAME, archived: 0 });
  if (created) {
    setStoredShoppingInboxListId(created.id);
    return created;
  }
  return null;
}

function extractShoppingLearningKeywordsFromItemName(name) {
  return String(name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !SHOPPING_KEYWORD_STOPWORDS.has(token));
}

function scoreStoreRuleAgainstItems(rule, normalizedItems) {
  const keywords = (rule?.keywords ?? [])
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (!keywords.length || !normalizedItems.length) return 0;
  let score = 0;
  keywords.forEach((keyword) => {
    if (normalizedItems.some((item) => item.includes(keyword))) {
      score += 1;
    }
  });
  return score;
}

function detectStoreFromItemsWithScore(items) {
  const rules = getStoreRulesForWorkspace();
  if (!rules.length || !items.length) return null;
  let bestRule = null;
  let bestScore = 0;
  const normalizedItems = items
    .map((item) => String(item ?? '').toLowerCase())
    .filter(Boolean);
  rules.forEach((rule) => {
    const score = scoreStoreRuleAgainstItems(rule, normalizedItems);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  });
  if (!bestRule || bestScore <= 0) return null;
  return {
    store: bestRule.store_name,
    score: bestScore
  };
}

function detectStoreFromItems(items) {
  const result = detectStoreFromItemsWithScore(items);
  return result?.store ?? null;
}

function getStoreNameFromShoppingList(list) {
  if (!list) return null;
  if (isShoppingInboxList(list)) return null;
  const parsed = parseStoreAndDateFromTitle(String(list.name ?? ''));
  const storeName = parsed.store ?? list.name ?? null;
  const normalized = normalizeTitleInput(storeName);
  return normalized || null;
}

function getShoppingTargetLists() {
  return getShoppingListsForWorkspace({ includeArchived: false })
    .filter((list) => !isShoppingInboxList(list));
}

function getSuggestedShoppingListIdForItems(items, candidateLists = getShoppingTargetLists()) {
  if (!candidateLists.length || !items.length) return null;
  const detected = detectStoreFromItemsWithScore(items);
  if (!detected?.store) return null;
  const normalizedStore = String(detected.store).trim().toLowerCase();
  if (!normalizedStore) return null;
  const match = candidateLists.find((list) => {
    const listStore = getStoreNameFromShoppingList(list);
    return listStore && listStore.toLowerCase() === normalizedStore;
  });
  return match?.id ?? null;
}

async function learnStoreRuleFromItemNames(storeName, itemNames) {
  if (!state.workspace) return;
  const normalizedStoreName = normalizeTitleInput(storeName);
  if (!normalizedStoreName) return;
  const learnedKeywords = Array.from(new Set(
    (itemNames ?? []).flatMap((itemName) => extractShoppingLearningKeywordsFromItemName(itemName))
  ));
  if (!learnedKeywords.length) return;

  const existingRule = getStoreRulesForWorkspace().find((rule) =>
    String(rule.store_name ?? '').trim().toLowerCase() === normalizedStoreName.toLowerCase()
  );
  if (!existingRule) {
    await createStoreRuleRecord({
      store_name: normalizedStoreName,
      keywords: learnedKeywords
    });
    return;
  }

  const currentKeywords = (existingRule.keywords ?? [])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  const mergedKeywords = Array.from(new Set([
    ...currentKeywords.map((entry) => entry.toLowerCase()),
    ...learnedKeywords
  ]));
  if (mergedKeywords.length === currentKeywords.length) return;
  await updateStoreRuleRecord(existingRule.id, { keywords: mergedKeywords.slice(0, 200) });
}

function getShoppingInboxItems() {
  const inbox = getShoppingInboxList();
  if (!inbox) return [];
  return getShoppingItemsForList(inbox.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

async function addItemsToShoppingInbox(rawInput = '') {
  const items = parseShoppingItems(rawInput);
  if (!items.length) return { added: 0, inbox: getShoppingInboxList() };
  const inbox = await ensureShoppingInboxListRecord();
  if (!inbox) return { added: 0, inbox: null };
  const created = await createShoppingItemsRecord(
    inbox.id,
    items.map((name) => ({ name }))
  );
  return { added: created.length, inbox };
}

async function moveShoppingInboxItemToList(itemId, targetListId) {
  const item = state.shoppingItems?.[itemId];
  if (!item) return false;
  if (!targetListId || isShoppingInboxListId(targetListId)) return false;
  const targetList = getShoppingListsForWorkspace({ includeArchived: false })
    .find((list) => list.id === targetListId);
  if (!targetList) return false;
  const created = await createShoppingItemsRecord(targetList.id, [{ name: item.name }]);
  if (!created.length) return false;
  await deleteShoppingItemRecord(item.id);
  return true;
}

function getNextTaskSortOrder(parentId = null, statusKey = null) {
  const workspaceId = state.workspace?.id;
  const tasks = Object.values(state.tasks);
  const filtered = tasks.filter(task => {
    if (workspaceId && task.workspace_id !== workspaceId) return false;
    const sameParent = (task.parent_id ?? null) === (parentId ?? null);
    if (!sameParent) return false;
    if (!parentId && statusKey) {
      return (task.status ?? getDefaultStatusKey()) === statusKey;
    }
    return true;
  });
  const maxSort = filtered.reduce((max, task) => {
    const sortValue = Number(task.sort_order);
    const safeSort = Number.isFinite(sortValue) ? sortValue : 0;
    return Math.max(max, safeSort);
  }, 0);
  return maxSort + 10;
}

function getFirstTaskSortOrder(parentId = null, statusKey = null) {
  const workspaceId = state.workspace?.id;
  const tasks = Object.values(state.tasks);
  const filtered = tasks.filter(task => {
    if (workspaceId && task.workspace_id !== workspaceId) return false;
    const sameParent = (task.parent_id ?? null) === (parentId ?? null);
    if (!sameParent) return false;
    if (!parentId && statusKey) {
      return (task.status ?? getDefaultStatusKey()) === statusKey;
    }
    return true;
  });
  const minSort = filtered.reduce((min, task) => {
    const sortValue = Number(task.sort_order);
    const safeSort = Number.isFinite(sortValue) ? sortValue : 0;
    return Math.min(min, safeSort);
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(minSort)) return 10;
  return minSort - 10;
}

function beginTaskDrag(event, task, itemEl = event.currentTarget) {
  if (event.target.closest('button')) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  draggingTaskId = task.id;
  draggingTaskEl = itemEl;
  const descendantIds = new Set(getDescendants(task.id).map(child => child.id));
  draggingTaskOrigin = {
    parentId: task.parent_id ?? null,
    status: normalizeTaskStatusValue(task.status),
    descendants: descendantIds
  };
  suppressTaskClick = true;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    if (itemEl) {
      const rect = itemEl.getBoundingClientRect();
      event.dataTransfer.setDragImage(itemEl, 16, Math.min(rect.height / 2, 20));
    }
  }
  itemEl?.classList.add('dragging');
}

function endTaskDrag(event) {
  draggingTaskEl?.classList.remove('dragging');
  document.querySelectorAll('.task-item.drop-subtask').forEach(item => item.classList.remove('drop-subtask'));
  taskTreeEl?.classList.remove('drag-over');
  draggingTaskId = null;
  draggingTaskEl = null;
  draggingTaskOrigin = null;
  setTimeout(() => {
    suppressTaskClick = false;
  }, 0);
}

function canDropTaskInContainer(parentId, statusKey) {
  if (!draggingTaskOrigin) return false;
  const normalizedParent = parentId ? parentId : null;
  const originParent = draggingTaskOrigin.parentId ?? null;
  const sameParent = originParent === normalizedParent;
  const movingToRoot = normalizedParent === null && originParent !== null;
  if (movingToRoot) return true;
  if (!sameParent) return false;
  if (statusKey && draggingTaskOrigin.status !== statusKey) return false;
  return true;
}

function canReparentTask(targetId) {
  if (!draggingTaskOrigin || !draggingTaskId) return false;
  if (draggingTaskId === targetId) return false;
  if ((draggingTaskOrigin.parentId ?? null) === targetId) return false;
  if (draggingTaskOrigin.descendants && draggingTaskOrigin.descendants.has(targetId)) return false;
  return true;
}

function isSubtaskDropZone(event, item) {
  const rect = item.getBoundingClientRect();
  const y = event.clientY;
  const margin = rect.height * 0.25;
  return y > rect.top + margin && y < rect.bottom - margin;
}

async function handleSubtaskDrop(targetId) {
  if (!draggingTaskId) return;
  if (!canReparentTask(targetId)) return;
  try {
    await reparentTaskRecord(draggingTaskId, targetId);
  } catch (err) {
    alert(err?.message ?? 'Unable to move task.');
    return;
  }
  try {
    await updateTaskRecord(draggingTaskId, { sort_order: getNextTaskSortOrder(targetId) });
  } catch (err) {
    const message = String(err?.message ?? '');
    if (err?.status === 404 || message.toLowerCase().includes('not found')) {
      await refreshWorkspace();
      return;
    }
    alert(err?.message ?? 'Unable to move task.');
    return;
  }
  render();
}

function getDirectTaskItems(container) {
  return Array.from(container.querySelectorAll(':scope > .task-item'));
}

function getGroupMetaForContainer(container) {
  const mode = container?.dataset?.groupMode ?? null;
  if (!mode) return null;
  const raw = container.dataset.groupValue;
  const value = raw !== undefined ? (raw || null) : null;
  return { mode, value };
}

function getSelectedDragTaskIds(originParentId) {
  const selected = getSelectedTaskIds();
  if (!selected.includes(draggingTaskId)) return [draggingTaskId];
  if (originParentId !== null) return [draggingTaskId];
  const roots = selected.filter(id => (state.tasks?.[id]?.parent_id ?? null) === null);
  if (roots.length <= 1) return [draggingTaskId];
  const originContainer = draggingTaskEl?.parentElement;
  if (originContainer) {
    const ordered = Array.from(originContainer.querySelectorAll(':scope > .task-item'))
      .map(el => el.dataset.taskId)
      .filter(id => roots.includes(id));
    return ordered.length ? ordered : roots;
  }
  return roots;
}

function getTaskElementsByIds(taskIds) {
  return taskIds
    .map(id => document.querySelector(`.task-item[data-task-id="${id}"]`))
    .filter(Boolean);
}

function attachQuickAddClick(addInput) {
  suppressQuickAddPointerEvents(addInput);
}

async function persistTaskOrder(container, parentId, statusKey, groupMeta) {
  const items = getDirectTaskItems(container);
  const normalizedGroup = groupMeta?.value !== undefined ? (groupMeta.value || null) : undefined;
  const mode = groupMeta?.mode ?? null;
  let workflowLinksChanged = false;
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].dataset.taskId;
    const task = state.tasks[id];
    if (!task) continue;
    const nextSort = (index + 1) * 10;
    const patch = {};
    if (task.sort_order !== nextSort) patch.sort_order = nextSort;
    if (statusKey && task.status !== statusKey) patch.status = statusKey;
    if (parentId === null && mode) {
      if (mode === 'section') {
        if ((task.group_label ?? null) !== normalizedGroup) patch.group_label = normalizedGroup;
      } else if (mode === 'task-type') {
        if ((task.type_label ?? null) !== normalizedGroup) patch.type_label = normalizedGroup;
      } else if (mode === 'priority') {
        const nextPriority = normalizedGroup ?? 'medium';
        if ((task.priority ?? 'medium') !== nextPriority) patch.priority = nextPriority;
      } else if (mode === 'workflow-phase') {
        const checklistInstanceId = getActiveWorkflowChecklistInstanceId();
        const link = getWorkflowInstanceLinkByTaskId(task.id);
        if (checklistInstanceId && link && link.workflow_instance_id === checklistInstanceId) {
          if ((link.phase_id ?? null) !== normalizedGroup) {
            link.phase_id = normalizedGroup;
            link.updated_at = nowIso();
            workflowLinksChanged = true;
          }
        }
      }
    }
    if (Object.keys(patch).length) {
      await updateTaskRecord(id, patch);
    }
  }
  if (workflowLinksChanged) {
    state.workflowInstanceTasks = [...(state.workflowInstanceTasks ?? [])];
    persistLocalData();
  }
  render();
}

function getKanbanCardItems(container) {
  return Array.from(container.querySelectorAll(':scope > .kanban-card'));
}

async function persistKanbanOrder(container, statusKey) {
  const cards = getKanbanCardItems(container);
  for (let index = 0; index < cards.length; index += 1) {
    const id = cards[index].dataset.taskId;
    const task = state.tasks[id];
    if (!task) continue;
    const nextSort = (index + 1) * 10;
    const patch = {};
    if (task.sort_order !== nextSort) patch.sort_order = nextSort;
    if (statusKey && task.status !== statusKey) patch.status = statusKey;
    if (Object.keys(patch).length) {
      await updateTaskRecord(id, patch);
    }
  }
  render();
}

async function persistColumnOrder(board) {
  const columns = Array.from(board.querySelectorAll('.kanban-column'));
  for (let index = 0; index < columns.length; index += 1) {
    const key = columns[index].dataset.statusKey;
    if (!key) continue;
    const status = getStatusByKey(key);
    if (!status) continue;
    const nextSort = (index + 1) * 10;
    if (status.sort_order === nextSort) continue;
    await updateStatusRecord(status.id, { sort_order: nextSort });
  }
  render();
}

function attachTaskDropzone(container, { parentId = null, statusKey = null, groupMode = null, groupValue } = {}) {
  const normalizedParent = parentId ? parentId : null;
  container.dataset.parentId = normalizedParent ?? '';
  if (statusKey) {
    container.dataset.statusKey = statusKey;
  } else {
    delete container.dataset.statusKey;
  }
  if (groupMode) {
    container.dataset.groupMode = groupMode;
    container.dataset.groupValue = groupValue ?? '';
  } else {
    delete container.dataset.groupMode;
    delete container.dataset.groupValue;
  }
  container.addEventListener('dragover', (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    const allowed = canDropTaskInContainer(parentId, statusKey);
    if (!allowed) return;
    event.preventDefault();
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
  });
  container.addEventListener('drop', async (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    const allowed = canDropTaskInContainer(parentId, statusKey);
    if (!allowed) return;
    event.preventDefault();
    container.classList.remove('drag-over');
    const targetContainer = container.classList.contains('task-root-dropzone')
      ? taskTreeEl?.querySelector('.task-list')
      : container;
    const draggingEl = document.querySelector(`.task-item[data-task-id="${draggingTaskId}"]`);
    const originContainer = draggingEl?.parentElement ?? null;
    const originParent = draggingTaskOrigin?.parentId ?? null;
    const normalizedParent = parentId ? parentId : null;
    const movingToRoot = normalizedParent === null && originParent !== null;
    const movingBetweenRoots = normalizedParent === null && originParent === null && draggingEl && draggingEl.parentElement !== targetContainer;
    if (movingToRoot) {
      try {
        await reparentTaskRecord(draggingTaskId, null);
        if (statusKey && draggingTaskOrigin?.status !== statusKey) {
          await updateTaskRecord(draggingTaskId, { status: statusKey });
        }
      } catch (err) {
        alert(err?.message ?? 'Unable to move task.');
        return;
      }
    }
    if (draggingEl && targetContainer && (draggingEl.parentElement === targetContainer || movingToRoot || movingBetweenRoots)) {
      const addRow = targetContainer.querySelector('.task-add-task');
      const selectedIds = getSelectedDragTaskIds(originParent);
      if (selectedIds.length > 1 && normalizedParent === null) {
        const elements = getTaskElementsByIds(selectedIds);
        elements.forEach(el => {
          if (addRow) {
            targetContainer.insertBefore(el, addRow);
          } else {
            targetContainer.appendChild(el);
          }
        });
      } else {
        if (addRow) {
          targetContainer.insertBefore(draggingEl, addRow);
        } else {
          targetContainer.appendChild(draggingEl);
        }
      }
    }
    if (targetContainer) {
      const meta = groupMode ? { mode: groupMode, value: groupValue ?? null } : null;
      await persistTaskOrder(targetContainer, parentId, statusKey, meta);
      if (originContainer && originContainer !== targetContainer) {
        const originParentId = originContainer.dataset.parentId || null;
        const originStatus = originContainer.dataset.statusKey || null;
        const originMeta = getGroupMetaForContainer(originContainer);
        await persistTaskOrder(originContainer, originParentId || null, originStatus || null, originMeta);
      }
    }
  });
}

function attachTaskDragHandlers(item, task) {
  item.draggable = false;
  item.dataset.taskId = task.id;
  const handle = item.querySelector('.task-drag-handle');
  if (handle) {
    handle.draggable = true;
    handle.addEventListener('dragstart', (event) => beginTaskDrag(event, task, item));
    handle.addEventListener('dragend', endTaskDrag);
  }
  item.addEventListener('dragover', (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    if (canReparentTask(task.id) && isSubtaskDropZone(event, item)) {
      event.preventDefault();
      item.classList.add('drop-subtask');
      return;
    }
    item.classList.remove('drop-subtask');
    const container = item.parentElement;
    const parentId = container?.dataset?.parentId ?? null;
    const statusKey = container?.dataset?.statusKey ?? null;
    const allowed = canDropTaskInContainer(parentId ? parentId : null, statusKey ?? null);
    if (!allowed) return;
    event.preventDefault();
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('drop-subtask');
  });
  item.addEventListener('drop', async (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    const selectedIds = getSelectedDragTaskIds(draggingTaskOrigin?.parentId ?? null);
    if (canReparentTask(task.id) && isSubtaskDropZone(event, item)) {
      if (selectedIds.length > 1) return;
      event.preventDefault();
      item.classList.remove('drop-subtask');
      await handleSubtaskDrop(task.id);
      return;
    }
    item.classList.remove('drop-subtask');
    const container = item.parentElement;
    const parentId = container?.dataset?.parentId ?? null;
    const statusKey = container?.dataset?.statusKey ?? null;
    const groupMode = container?.dataset?.groupMode ?? null;
    const groupValue = container?.dataset?.groupValue;
    const groupMeta = groupMode ? { mode: groupMode, value: groupValue !== undefined ? (groupValue || null) : null } : null;
    const allowed = canDropTaskInContainer(parentId ? parentId : null, statusKey ?? null);
    if (!allowed) return;
    event.preventDefault();
    const draggingEl = document.querySelector(`.task-item[data-task-id="${draggingTaskId}"]`);
    if (!draggingEl || draggingEl === item) return;
    const originContainer = draggingEl.parentElement;
    const originParent = draggingTaskOrigin?.parentId ?? null;
    const normalizedParent = parentId ? parentId : null;
    const movingToRoot = normalizedParent === null && originParent !== null;
    const movingBetweenRoots = normalizedParent === null && originParent === null && draggingEl.parentElement !== container;
    if (draggingEl.parentElement !== container) {
      if (!movingToRoot && !movingBetweenRoots) return;
      try {
        if (movingToRoot) {
          await reparentTaskRecord(draggingTaskId, null);
          if (statusKey && draggingTaskOrigin?.status !== statusKey) {
            await updateTaskRecord(draggingTaskId, { status: statusKey });
          }
        }
      } catch (err) {
        alert(err?.message ?? 'Unable to move task.');
        return;
      }
    }
    const rect = item.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    if (selectedIds.length > 1 && normalizedParent === null) {
      const elements = getTaskElementsByIds(selectedIds);
      const referenceNode = insertAfter ? item.nextSibling : item;
      elements.forEach(el => container.insertBefore(el, referenceNode));
    } else {
      container.insertBefore(draggingEl, insertAfter ? item.nextSibling : item);
    }
    await persistTaskOrder(container, normalizedParent, statusKey ?? null, groupMeta);
    if (originContainer && originContainer !== container) {
      const originParentId = originContainer.dataset.parentId || null;
      const originStatus = originContainer.dataset.statusKey || null;
      const originMeta = getGroupMetaForContainer(originContainer);
      await persistTaskOrder(originContainer, originParentId || null, originStatus || null, originMeta);
    }
  });
}

function attachKanbanDropzone(container, statusKey) {
  container.dataset.statusKey = statusKey;
  container.addEventListener('dragover', (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    event.preventDefault();
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
  });
  container.addEventListener('drop', async (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    event.preventDefault();
    container.classList.remove('drag-over');
    const draggingEl = document.querySelector(`.kanban-card[data-task-id="${draggingTaskId}"]`);
    if (draggingEl) {
      container.appendChild(draggingEl);
    }
    await persistKanbanOrder(container, statusKey);
  });
}

function attachKanbanDragHandlers(card, task) {
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.addEventListener('dragstart', (event) => beginTaskDrag(event, task));
  card.addEventListener('dragend', endTaskDrag);
  card.addEventListener('dragover', (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    event.preventDefault();
  });
  card.addEventListener('drop', async (event) => {
    if (!draggingTaskId || draggingColumnKey) return;
    event.preventDefault();
    const container = card.parentElement;
    const statusKey = container?.dataset?.statusKey ?? null;
    const draggingEl = document.querySelector(`.kanban-card[data-task-id="${draggingTaskId}"]`);
    if (!draggingEl || draggingEl === card) {
      await persistKanbanOrder(container, statusKey);
      return;
    }
    const rect = card.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(draggingEl, insertAfter ? card.nextSibling : card);
    await persistKanbanOrder(container, statusKey);
  });
}

function beginColumnDrag(event, statusKey, columnEl) {
  if (event.target.closest('button')) {
    event.preventDefault();
    return;
  }
  draggingColumnKey = statusKey;
  draggingColumnEl = columnEl;
  columnOrderDirty = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', statusKey);
  }
  columnEl.classList.add('dragging-column');
}

function endColumnDrag(event) {
  if (draggingColumnEl) {
    draggingColumnEl.classList.remove('dragging-column');
  }
  const board = draggingColumnEl?.parentElement;
  const shouldPersist = columnOrderDirty && board;
  draggingColumnKey = null;
  draggingColumnEl = null;
  columnOrderDirty = false;
  if (shouldPersist) {
    persistColumnOrder(board);
  }
}

function beginSectionDrag(event, sectionId, sectionEl) {
  if (!sectionId || !sectionEl) return;
  if (event.target.closest('button')) {
    event.preventDefault();
    return;
  }
  draggingSectionId = sectionId;
  draggingSectionEl = sectionEl;
  sectionOrderDirty = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sectionId);
  }
  sectionEl.classList.add('dragging-section');
}

function endSectionDrag() {
  if (draggingSectionEl) {
    draggingSectionEl.classList.remove('dragging-section');
  }
  const list = draggingSectionEl?.parentElement;
  const shouldPersist = sectionOrderDirty && list;
  draggingSectionId = null;
  draggingSectionEl = null;
  sectionOrderDirty = false;
  if (shouldPersist) {
    persistSectionOrder(list);
  }
}

function persistSectionOrder(listEl) {
  const workspaceId = state.workspace?.id;
  if (!workspaceId) return;
  const projectId = getActiveTaskSectionScopeProjectId();
  const sections = (state.taskSections ?? [])
    .map(normalizeTaskSection)
    .filter(section =>
      section.workspace_id === workspaceId
      && normalizeSectionScopeProjectId(section.project_id) === projectId
    );
  if (!sections.length) return;
  const byId = new Map(sections.map(section => [section.id, section]));
  const orderedIds = Array.from(listEl.querySelectorAll('.task-group-section'))
    .map(section => section.dataset.sectionId)
    .filter(id => id && byId.has(id));
  orderedIds.forEach((id, index) => {
    const record = byId.get(id);
    const nextSort = (index + 1) * 10;
    if (!record) return;
    if (record.sort_order !== nextSort) {
      record.sort_order = nextSort;
      record.updated_at = nowIso();
    }
  });
  state.taskSections = [...(state.taskSections ?? [])];
  persistLocalData();
  render();
}

function persistWorkflowEntryOrder(scope, parentId, orderedIds) {
  if (!parentId || !orderedIds.length) return;
  const now = nowIso();
  const sortById = new Map(orderedIds.map((id, index) => [id, (index + 1) * 10]));
  if (scope === 'phase') {
    const entries = state.workflowPhaseTasks ?? [];
    let changed = false;
    entries.forEach(entry => {
      if (entry.phase_id !== parentId) return;
      const nextSort = sortById.get(entry.id);
      if (!Number.isFinite(nextSort)) return;
      if ((entry.sort_order ?? 0) === nextSort) return;
      entry.sort_order = nextSort;
      entry.updated_at = now;
      changed = true;
    });
    if (changed) {
      state.workflowPhaseTasks = [...entries];
      persistLocalData();
    }
    return;
  }
  if (scope === 'pattern') {
    const entries = state.workflowPatternTasks ?? [];
    let changed = false;
    entries.forEach(entry => {
      const normalized = normalizeWorkflowPatternTask(entry);
      if (normalized.pattern_id !== parentId) return;
      const nextSort = sortById.get(normalized.id);
      if (!Number.isFinite(nextSort)) return;
      if ((normalized.sort_order ?? 0) === nextSort) return;
      entry.sort_order = nextSort;
      entry.updated_at = now;
      changed = true;
    });
    if (changed) {
      state.workflowPatternTasks = [...entries];
      persistLocalData();
    }
  }
}

function canDropWorkflowEntry(scope, parentId, entryId = null) {
  if (!draggingWorkflowEntryMeta || !draggingWorkflowEntryEl) return false;
  if (draggingWorkflowEntryMeta.scope !== scope) return false;
  if (draggingWorkflowEntryMeta.parentId !== parentId) return false;
  if (entryId && draggingWorkflowEntryMeta.entryId === entryId) return false;
  return true;
}

function clearWorkflowEntryDragStyles() {
  document.querySelectorAll('.workflow-task-row.drag-over').forEach(row => row.classList.remove('drag-over'));
  document.querySelectorAll('.workflow-entry-dropzone.drag-over').forEach(zone => zone.classList.remove('drag-over'));
}

function beginWorkflowEntryDrag(event, meta, row) {
  draggingWorkflowEntryMeta = meta;
  draggingWorkflowEntryEl = row;
  row.classList.add('dragging-workflow-entry');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', meta.entryId);
  }
}

function endWorkflowEntryDrag() {
  if (draggingWorkflowEntryEl) {
    draggingWorkflowEntryEl.classList.remove('dragging-workflow-entry');
  }
  clearWorkflowEntryDragStyles();
  draggingWorkflowEntryMeta = null;
  draggingWorkflowEntryEl = null;
}

function attachWorkflowEntryDropzone(container, scope, parentId) {
  if (!container || !parentId) return;
  container.classList.add('workflow-entry-dropzone');
  container.dataset.workflowScope = scope;
  container.dataset.workflowParentId = parentId;
  container.addEventListener('dragover', (event) => {
    if (!canDropWorkflowEntry(scope, parentId)) return;
    event.preventDefault();
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', (event) => {
    if (!container.contains(event.relatedTarget)) {
      container.classList.remove('drag-over');
    }
  });
  container.addEventListener('drop', (event) => {
    if (!canDropWorkflowEntry(scope, parentId)) return;
    event.preventDefault();
    container.classList.remove('drag-over');
    const onRow = event.target.closest('.workflow-task-row');
    if (onRow && onRow.parentElement === container) return;
    if (!draggingWorkflowEntryEl) return;
    container.appendChild(draggingWorkflowEntryEl);
    const orderedIds = Array.from(container.querySelectorAll('.workflow-task-row[data-entry-id]'))
      .map(row => row.dataset.entryId)
      .filter(Boolean);
    persistWorkflowEntryOrder(scope, parentId, orderedIds);
    render();
  });
}

function attachWorkflowEntryDragHandlers(row, handle, scope, parentId, entryId) {
  if (!row || !handle || !scope || !parentId || !entryId) return;
  const meta = { scope, parentId, entryId };
  handle.draggable = true;
  handle.addEventListener('dragstart', (event) => beginWorkflowEntryDrag(event, meta, row));
  handle.addEventListener('dragend', endWorkflowEntryDrag);
  row.addEventListener('dragover', (event) => {
    if (!canDropWorkflowEntry(scope, parentId, entryId)) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('drag-over');
  });
  row.addEventListener('drop', (event) => {
    if (!canDropWorkflowEntry(scope, parentId, entryId)) return;
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('drag-over');
    if (!draggingWorkflowEntryEl || draggingWorkflowEntryEl === row) return;
    const container = row.parentElement;
    if (!container) return;
    const rect = row.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(draggingWorkflowEntryEl, insertAfter ? row.nextSibling : row);
    const orderedIds = Array.from(container.querySelectorAll('.workflow-task-row[data-entry-id]'))
      .map(item => item.dataset.entryId)
      .filter(Boolean);
    persistWorkflowEntryOrder(scope, parentId, orderedIds);
    render();
  });
}

function persistWorkflowPhaseOrder(variantId, orderedPhaseIds) {
  if (!variantId || !orderedPhaseIds.length) return;
  const orderMap = new Map(orderedPhaseIds.map((phaseId, index) => [phaseId, (index + 1) * 10]));
  const links = state.workflowVariantPhases ?? [];
  let changed = false;
  links.forEach(link => {
    if (link.variant_id !== variantId) return;
    const nextSort = orderMap.get(link.phase_id);
    if (!Number.isFinite(nextSort)) return;
    if ((link.sort_order ?? 0) === nextSort) return;
    link.sort_order = nextSort;
    changed = true;
  });
  if (changed) {
    state.workflowVariantPhases = [...links];
    persistLocalData();
  }
}

function clearWorkflowPhaseDragStyles() {
  document.querySelectorAll('.workflow-phase.drag-over').forEach(card => card.classList.remove('drag-over'));
  document.querySelectorAll('.workflow-phase-list.drag-over').forEach(list => list.classList.remove('drag-over'));
}

function canDropWorkflowPhase(variantId, phaseId = null) {
  if (!draggingWorkflowPhaseMeta || !draggingWorkflowPhaseEl) return false;
  if (draggingWorkflowPhaseMeta.variantId !== variantId) return false;
  if (phaseId && draggingWorkflowPhaseMeta.phaseId === phaseId) return false;
  return true;
}

function beginWorkflowPhaseDrag(event, variantId, phaseId, phaseEl) {
  draggingWorkflowPhaseMeta = { variantId, phaseId };
  draggingWorkflowPhaseEl = phaseEl;
  phaseEl.classList.add('dragging-workflow-phase');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', phaseId);
  }
}

function endWorkflowPhaseDrag() {
  if (draggingWorkflowPhaseEl) {
    draggingWorkflowPhaseEl.classList.remove('dragging-workflow-phase');
  }
  clearWorkflowPhaseDragStyles();
  draggingWorkflowPhaseMeta = null;
  draggingWorkflowPhaseEl = null;
}

function attachWorkflowPhaseDropzone(phaseList, variantId) {
  if (!phaseList || !variantId) return;
  phaseList.addEventListener('dragover', (event) => {
    if (!canDropWorkflowPhase(variantId)) return;
    event.preventDefault();
    phaseList.classList.add('drag-over');
  });
  phaseList.addEventListener('dragleave', (event) => {
    if (!phaseList.contains(event.relatedTarget)) {
      phaseList.classList.remove('drag-over');
    }
  });
  phaseList.addEventListener('drop', (event) => {
    if (!canDropWorkflowPhase(variantId)) return;
    event.preventDefault();
    phaseList.classList.remove('drag-over');
    const onCard = event.target.closest('.workflow-phase');
    if (onCard && onCard.parentElement === phaseList) return;
    if (!draggingWorkflowPhaseEl) return;
    const firstNonPhase = Array.from(phaseList.children).find(child => !child.classList.contains('workflow-phase'));
    if (firstNonPhase) {
      phaseList.insertBefore(draggingWorkflowPhaseEl, firstNonPhase);
    } else {
      phaseList.appendChild(draggingWorkflowPhaseEl);
    }
    const orderedPhaseIds = Array.from(phaseList.children)
      .filter(child => child.classList.contains('workflow-phase'))
      .map(child => child.dataset.phaseId)
      .filter(Boolean);
    persistWorkflowPhaseOrder(variantId, orderedPhaseIds);
    render();
  });
}

function attachWorkflowPhaseDragHandlers(phaseCard, handle, variantId, phaseId) {
  if (!phaseCard || !handle || !variantId || !phaseId) return;
  handle.draggable = true;
  handle.addEventListener('dragstart', (event) => beginWorkflowPhaseDrag(event, variantId, phaseId, phaseCard));
  handle.addEventListener('dragend', endWorkflowPhaseDrag);
  phaseCard.addEventListener('dragover', (event) => {
    if (!canDropWorkflowPhase(variantId, phaseId)) return;
    event.preventDefault();
    phaseCard.classList.add('drag-over');
  });
  phaseCard.addEventListener('dragleave', () => {
    phaseCard.classList.remove('drag-over');
  });
  phaseCard.addEventListener('drop', (event) => {
    if (!canDropWorkflowPhase(variantId, phaseId)) return;
    event.preventDefault();
    event.stopPropagation();
    phaseCard.classList.remove('drag-over');
    if (!draggingWorkflowPhaseEl || draggingWorkflowPhaseEl === phaseCard) return;
    const container = phaseCard.parentElement;
    if (!container) return;
    const rect = phaseCard.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(draggingWorkflowPhaseEl, insertAfter ? phaseCard.nextSibling : phaseCard);
    const orderedPhaseIds = Array.from(container.children)
      .filter(child => child.classList.contains('workflow-phase'))
      .map(child => child.dataset.phaseId)
      .filter(Boolean);
    persistWorkflowPhaseOrder(variantId, orderedPhaseIds);
    render();
  });
}

function buildTree(tasks) {
  const map = new Map();
  tasks.forEach(task => {
    map.set(task.id, { ...task, children: [] });
  });
  const roots = [];
  map.forEach(task => {
    if (task.parent_id && map.has(task.parent_id)) {
      map.get(task.parent_id).children.push(task);
    } else {
      roots.push(task);
    }
  });
  return roots;
}

function sortTree(nodes, comparator = compareTasksByPriority) {
  nodes.sort(comparator);
  nodes.forEach(node => sortTree(node.children, comparator));
}

function compareTasksByDueDate(a, b, direction = 'asc') {
  const aTime = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return direction === 'asc' ? aTime - bTime : bTime - aTime;
  }
  return compareTasksByPriority(a, b);
}

function getTopLevelTaskId(taskId, visibleIds = null) {
  let current = state.tasks?.[taskId];
  while (current?.parent_id) {
    if (visibleIds && !visibleIds.has(current.parent_id)) break;
    const parent = state.tasks?.[current.parent_id];
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? taskId;
}

function getTaskPriorityWeight(priority) {
  if (priority === 'critical') return 400;
  if (priority === 'high') return 300;
  if (priority === 'medium') return 200;
  if (priority === 'low') return 100;
  return 0;
}

function getTaskStatusWeight(status) {
  if (isInProgressStatusKey(status)) return 160;
  if (isPlannedStatusKey(status)) return 120;
  if (isInboxStatusKey(status)) return 90;
  if (isWaitingStatusKey(status)) return 40;
  if (isBlockedStatusKey(status)) return 10;
  if (isDoneStatusKey(status) || isCanceledStatusKey(status)) return -1000;
  return 0;
}

function getTaskDueWeight(task) {
  if (!task?.due_at) return 0;
  const dueAt = new Date(task.due_at).getTime();
  if (Number.isNaN(dueAt)) return 0;
  const now = Date.now();
  const days = Math.floor((dueAt - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return 280;
  if (days === 0) return 220;
  if (days <= 2) return 170;
  if (days <= 6) return 120;
  if (days <= 13) return 70;
  return 20;
}

function scoreTaskForQueue(task) {
  if (!task) return -1000;
  let score = 0;
  score += getTaskStatusWeight(task.status ?? getDefaultStatusKey());
  score += getTaskPriorityWeight(task.priority ?? 'medium');
  score += getTaskDueWeight(task);
  if (hasIncompleteDependencies(task.id)) score -= 80;
  if (isDoneStatusKey(task.status) || isCanceledStatusKey(task.status)) score -= 2000;
  return score;
}

function buildAiQueueRankMap(tasks) {
  const visibleIds = new Set((tasks ?? []).map(task => task.id));
  const roots = (tasks ?? []).filter(task => !task.parent_id || !visibleIds.has(task.parent_id));
  const rankMap = new Map();

  getAiSuggestions().forEach((entry) => {
    if (!entry?.task_id) return;
    if (entry.decision === 'rejected') return;
    if (!visibleIds.has(entry.task_id)) return;
    const rootId = getTopLevelTaskId(entry.task_id, visibleIds);
    if (!rootId || rankMap.has(rootId)) return;
    rankMap.set(rootId, rankMap.size);
  });

  if (!rankMap.size) {
    roots
      .slice()
      .sort((a, b) => scoreTaskForQueue(b) - scoreTaskForQueue(a) || compareTasksByPriority(a, b))
      .forEach((task) => {
        rankMap.set(task.id, rankMap.size);
      });
    return rankMap;
  }

  roots
    .filter(task => !rankMap.has(task.id))
    .sort((a, b) => scoreTaskForQueue(b) - scoreTaskForQueue(a) || compareTasksByPriority(a, b))
    .forEach((task) => {
      rankMap.set(task.id, rankMap.size);
    });
  return rankMap;
}

function compareTasksByAiQueue(a, b, rankMap) {
  const aStatus = a.status ?? getDefaultStatusKey();
  const bStatus = b.status ?? getDefaultStatusKey();
  const aComplete = isDoneStatusKey(aStatus) || isCanceledStatusKey(aStatus);
  const bComplete = isDoneStatusKey(bStatus) || isCanceledStatusKey(bStatus);
  if (aComplete !== bComplete) return aComplete ? 1 : -1;

  const aRootId = getTopLevelTaskId(a.id);
  const bRootId = getTopLevelTaskId(b.id);
  const aRank = rankMap.get(aRootId);
  const bRank = rankMap.get(bRootId);
  const aHasRank = Number.isInteger(aRank);
  const bHasRank = Number.isInteger(bRank);
  if (aHasRank && bHasRank && aRank !== bRank) return aRank - bRank;
  if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;

  const scoreDiff = scoreTaskForQueue(b) - scoreTaskForQueue(a);
  if (scoreDiff !== 0) return scoreDiff;
  return compareTasksByPriority(a, b);
}

function getAiQueueComparator(tasks = null) {
  const rankMap = buildAiQueueRankMap(tasks ?? getFilteredTasks());
  return (a, b) => compareTasksByAiQueue(a, b, rankMap);
}

function getTaskSortComparator(tasks = null) {
  const key = getTaskSortKey();
  if (key === 'due-asc') {
    return (a, b) => compareTasksByDueDate(a, b, 'asc');
  }
  if (key === 'due-desc') {
    return (a, b) => compareTasksByDueDate(a, b, 'desc');
  }
  return compareTasksByPriority;
}

function renderSmartViewBanner(tasks) {
  if (isWorkflowChecklistViewActive()) return;
  const banner = document.createElement('section');
  banner.className = 'ai-queue-banner';

  const title = document.createElement('div');
  title.className = 'ai-queue-title';
  title.textContent = 'Smart View';
  banner.appendChild(title);

  const suggestionCount = getAiSuggestions().filter(item => item?.task_id && item.decision !== 'rejected').length;
  const rankCount = buildAiQueueRankMap(tasks).size;
  const summary = document.createElement('div');
  summary.className = 'ai-queue-summary';
  summary.textContent = suggestionCount
    ? `Showing intelligently prioritized work. ${rankCount} task${rankCount === 1 ? '' : 's'} ranked.`
    : 'Showing fallback smart priority by status, due dates, and urgency.';
  banner.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'ai-queue-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'subtle-button';
  refreshBtn.textContent = state.ui?.aiSuggestionLoading ? 'Refreshing…' : 'Refresh priorities';
  refreshBtn.disabled = Boolean(state.ui?.aiSuggestionLoading);
  refreshBtn.addEventListener('click', async () => {
    await refreshAiSuggestions(tasks);
  });
  actions.appendChild(refreshBtn);

  banner.appendChild(actions);
  taskTreeEl.appendChild(banner);
}

function getAiSuggestionMinutes() {
  const raw = Number(state.ui?.aiSuggestionMinutes);
  if (!Number.isFinite(raw) || raw < 5) return 60;
  return Math.round(raw);
}

function setAiSuggestionMinutes(value) {
  const next = Math.max(5, Math.round(Number(value) || 60));
  state.ui = state.ui ?? {};
  state.ui.aiSuggestionMinutes = next;
}

function getAiSuggestions() {
  return Array.isArray(state.ui?.aiSuggestions) ? state.ui.aiSuggestions : [];
}

function setAiSuggestions(suggestions, notes = '') {
  state.ui = state.ui ?? {};
  state.ui.aiSuggestions = suggestions;
  state.ui.aiSuggestionNotes = notes;
}

function getAiSuggestionNotes() {
  return String(state.ui?.aiSuggestionNotes ?? '').trim();
}

function setAiSuggestionDecision(suggestionId, decision) {
  if (!suggestionId) return;
  const suggestions = getAiSuggestions().map((item) => {
    if (item.id !== suggestionId) return item;
    return {
      ...item,
      decision
    };
  });
  setAiSuggestions(suggestions, getAiSuggestionNotes());
}

async function refreshAiSuggestions(tasks) {
  state.ui = state.ui ?? {};
  state.ui.aiSuggestionLoading = true;
  render();
  try {
    const minutes = getAiSuggestionMinutes();
    const payloadTasks = (tasks ?? []).map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_at: task.due_at ?? null
    }));
    const result = await api.suggestTasks({
      tasks: payloadTasks,
      context: {
        workspace_id: state.workspace?.id ?? null,
        time_available_minutes: minutes
      }
    });
    const suggestions = (result?.suggestions ?? []).map(item => ({
      ...item,
      id: createId(),
      decision: null
    }));
    setAiSuggestions(suggestions, result?.notes ?? '');
  } catch (err) {
    alert(err?.message ?? 'Unable to load AI suggestions.');
  } finally {
    state.ui.aiSuggestionLoading = false;
    render();
  }
}

function renderAiSuggestionsMenu(tasks) {
  if (!taskAiMenu) return;
  taskAiMenu.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'ai-suggestions-header';
  const title = document.createElement('h3');
  title.textContent = 'AI Suggestions';
  const controls = document.createElement('div');
  controls.className = 'ai-suggestions-controls';

  const minutesInput = document.createElement('input');
  minutesInput.type = 'number';
  minutesInput.min = '5';
  minutesInput.step = '5';
  minutesInput.value = String(getAiSuggestionMinutes());
  minutesInput.title = 'Minutes available';
  minutesInput.addEventListener('change', () => {
    setAiSuggestionMinutes(minutesInput.value);
  });

  const suggestBtn = document.createElement('button');
  suggestBtn.type = 'button';
  suggestBtn.className = 'subtle-button';
  suggestBtn.textContent = state.ui?.aiSuggestionLoading ? 'Generating…' : 'Suggest next';
  suggestBtn.disabled = Boolean(state.ui?.aiSuggestionLoading);
  suggestBtn.addEventListener('click', async () => {
    await refreshAiSuggestions(tasks);
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'subtle-button';
  clearBtn.textContent = 'Clear';
  clearBtn.disabled = getAiSuggestions().length === 0;
  clearBtn.addEventListener('click', () => {
    setAiSuggestions([], '');
    render();
  });

  controls.appendChild(minutesInput);
  controls.appendChild(suggestBtn);
  controls.appendChild(clearBtn);
  header.appendChild(title);
  header.appendChild(controls);
  taskAiMenu.appendChild(header);

  const notes = getAiSuggestionNotes();
  if (notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'ai-suggestions-notes';
    notesEl.textContent = notes;
    taskAiMenu.appendChild(notesEl);
  }

  const list = document.createElement('div');
  list.className = 'ai-suggestions-list';
  const suggestions = getAiSuggestions();
  if (!suggestions.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No suggestions yet. Click "Suggest next".';
    list.appendChild(empty);
  } else {
    suggestions.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'ai-suggestion-row';

      const message = document.createElement('div');
      message.className = 'ai-suggestion-message';
      message.textContent = entry.message ?? 'Suggestion';
      row.appendChild(message);

      const actions = document.createElement('div');
      actions.className = 'ai-suggestion-actions';
      if (entry.decision) {
        const badge = document.createElement('span');
        badge.className = `ai-suggestion-decision ${entry.decision}`;
        badge.textContent = entry.decision === 'accepted' ? 'Accepted' : 'Rejected';
        actions.appendChild(badge);
      } else {
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'subtle-button';
        acceptBtn.textContent = 'Accept';
        acceptBtn.addEventListener('click', () => {
          setAiSuggestionDecision(entry.id, 'accepted');
          if (entry.type === 'next-action' && entry.task_id && state.tasks?.[entry.task_id]) {
            openTaskEditor(entry.task_id);
          }
          render();
        });
        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'subtle-button';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', () => {
          setAiSuggestionDecision(entry.id, 'rejected');
          render();
        });
        actions.appendChild(acceptBtn);
        actions.appendChild(rejectBtn);
      }
      row.appendChild(actions);
      list.appendChild(row);
    });
  }
  taskAiMenu.appendChild(list);
}

function render() {
  syncAuthGatePage();
  const mobileSchedulingView = isMobileViewport() && getActiveView() === 'scheduling';
  document.body.classList.toggle('mobile-scheduling-view', mobileSchedulingView);
  const currentSelected = getSelectedTaskIds();
  const validSelected = currentSelected.filter(id => state.tasks?.[id]);
  if (validSelected.length !== currentSelected.length) {
    state.ui = state.ui ?? {};
    state.ui.selectedTaskIds = validSelected;
  }
  renderWorkspaceList();
  renderAccountMenu();
  renderProfilePage();
  renderAdminPage();
  renderTaskSidebarList();
  renderProjectList();
  renderProjectsPage();
  renderWorkflowList();
  renderTemplateList();
  renderTeamMemberList();
  renderTaskTypeList();
  renderScheduleEventTypeList();
  renderStoreRuleList();
  renderWorkspaceManageList();
  renderWorkspaceArchivedList();
  renderShoppingListList();
  renderNoticeSidebarList();
  renderNoticesPageList();
  renderWorkflowsPage();
  renderNoticeBellMenu();
  renderTaskFilter();
  renderTaskTools();
  renderTaskShoppingInbox();
  renderTaskSort();
  renderTaskGroup();
  renderNoticeFilter();
  renderNoticeSort();
  renderProjectFilter();
  renderShoppingFilter();
  renderTaskViewToggle();
  renderBulkSelectionBar();
  if (activeTaskId && !state.tasks[activeTaskId]) {
    closeTaskEditor();
  }
  if (activeTaskId && state.tasks[activeTaskId]) {
    renderTaskEditorSubtasks(state.tasks[activeTaskId]);
    renderTaskEditorDependencies(state.tasks[activeTaskId]);
    populateDependencySelect(state.tasks[activeTaskId]);
  }
  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLInputElement && activeEl.classList.contains('task-add-input')) {
    state.ui = state.ui ?? {};
    state.ui.taskAddFocused = true;
    state.ui.taskAddDraft = activeEl.value;
  } else if (state.ui?.taskAddFocused) {
    state.ui.taskAddFocused = false;
  }
  taskTreeEl.innerHTML = '';
  const tasks = getFilteredTasks();
  const tree = buildTree(tasks);
  // Notices are shown in the sidebar now.
  const view = getTaskView();
  taskTreeEl.classList.toggle('task-tree-calendar-view', view === 'calendar');
  if (view === 'kanban') {
    sortTree(tree, compareTasksByPriority);
    renderKanban(tree);
  } else if (view === 'calendar') {
    renderCalendarView(tasks);
  } else if (view === 'smart') {
    sortTree(tree, getAiQueueComparator(tasks));
    renderSmartViewBanner(tasks);
    renderTaskList(tree);
  } else {
    sortTree(tree, getTaskSortComparator(tasks));
    renderTaskList(tree);
  }
  if (taskAiMenu && !taskAiMenu.classList.contains('hidden')) {
    renderAiSuggestionsMenu(tasks);
  }
  renderShoppingPanel();
  renderSchedulingPage();
  renderSchedulingSidebar();
  syncMobileCalendarsModalInputs();
  if (!isMobileViewport() || getActiveView() !== 'scheduling') {
    closeMobileCalendarsModal();
  }
  renderView();
  renderModuleNavigation();
  renderMobileNavigation();
  if (taskColumnsModal && !taskColumnsModal.classList.contains('hidden')) {
    renderTaskColumnsModal();
  }
  if (noticeModal && !noticeModal.classList.contains('hidden')) {
    renderNoticeTypeSelect(noticeType?.value ?? '');
  }
  renderNotificationStatus();
  renderTaskUiSettings();
  renderSchedulingUiSettings();
  renderHelpPage();
  renderSettingsTabs();
  renderGlobalSearch();
  if ((settingsModal && !settingsModal.classList.contains('hidden')) || getActiveView() === 'audit-log') {
    renderAuditLogOutput();
  }
  if (checkinDefaultMinutesInput) {
    const activeEl = document.activeElement;
    if (activeEl !== checkinDefaultMinutesInput) {
      checkinDefaultMinutesInput.value = String(getCheckinExtendMinutes());
    }
  }
  if (checkinNoModal && !checkinNoModal.classList.contains('hidden') && checkinNoExtend) {
    checkinNoExtend.textContent = `Extend session (${getCheckinExtendMinutes()} min)`;
  }
  updateTaskEditorScrollbar();
  syncCheckinModal();
  maybeShowCheckinModal();
  syncNavigationHistory();
  saveState(state);
  persistLocalData();
}

function renderView() {
  const view = getActiveView();
  const showTasks = view === 'tasks';
  const showScheduling = view === 'scheduling';
  const showProjects = view === 'projects';
  const showShopping = view === 'shopping';
  const showNotices = view === 'notices';
  const showWorkflows = view === 'workflows';
  const showHelp = view === 'help';
  const showAdmin = view === 'admin';
  const showProfile = view === 'profile';
  const showDataTransfer = view === 'data-transfer';
  const showAuditLog = view === 'audit-log';
  const showAutomation = view === 'automation';
  const showManageWorkspaces = view === 'workspaces-manage';
  const showArchivedWorkspaces = view === 'workspaces-archived';

  tasksPanel?.classList.toggle('hidden', !showTasks);
  schedulingPage?.classList.toggle('hidden', !showScheduling);
  projectsPage?.classList.toggle('hidden', !showProjects);
  shoppingPage?.classList.toggle('hidden', !showShopping);
  noticesPage?.classList.toggle('hidden', !showNotices);
  workflowsPage?.classList.toggle('hidden', !showWorkflows);
  helpPage?.classList.toggle('hidden', !showHelp);
  adminPage?.classList.toggle('hidden', !showAdmin);
  profilePage?.classList.toggle('hidden', !showProfile);
  dataTransferPage?.classList.toggle('hidden', !showDataTransfer);
  auditLogPage?.classList.toggle('hidden', !showAuditLog);
  automationPage?.classList.toggle('hidden', !showAutomation);
  workspaceManagePage?.classList.toggle('hidden', !showManageWorkspaces);
  workspaceArchivedPage?.classList.toggle('hidden', !showArchivedWorkspaces);
}

function getTaskContainersForWorkspace({ kind = null, includeArchived = false } = {}) {
  if (!state.workspace) return [];
  const targetKind = kind ? normalizeProjectKind(kind) : null;
  return (state.projects ?? [])
    .map(normalizeProject)
    .filter((project) => {
      if (project.workspace_id !== state.workspace.id) return false;
      if (!includeArchived && project.archived) return false;
      if (targetKind && normalizeProjectKind(project.kind) !== targetKind) return false;
      return true;
    });
}

function renderHelpPage() {
  const publicBase = typeof window !== 'undefined' ? window.location.origin : 'https://brianhub.com';
  const workspaceId = state.workspace?.id ?? '<workspace-id>';
  if (helpApiBase) {
    helpApiBase.textContent = publicBase;
  }
  if (helpWorkspaceId) {
    helpWorkspaceId.textContent = workspaceId;
  }
  if (helpTaskCreateExample) {
    helpTaskCreateExample.textContent = JSON.stringify({
      workspace_id: workspaceId,
      title: 'Buy groceries',
      group_label: 'Errands'
    }, null, 2);
  }
  if (helpTaskUpdateExample) {
    helpTaskUpdateExample.textContent = JSON.stringify({
      group_label: 'Today'
    }, null, 2);
  }
  if (helpSyncPullExample) {
    helpSyncPullExample.textContent = JSON.stringify({
      workspace_id: workspaceId,
      cursor: 0
    }, null, 2);
  }
}

function getProjectsForWorkspace(options = {}) {
  return getTaskContainersForWorkspace({ ...options, kind: PROJECT_KIND_PROJECT });
}

function getTaskListsForWorkspace(options = {}) {
  return getTaskContainersForWorkspace({ ...options, kind: PROJECT_KIND_LIST });
}

function getTaskContainerById(id) {
  if (!id) return null;
  return getTaskContainersForWorkspace({ includeArchived: true }).find((project) => project.id === id) ?? null;
}

function getWorkspaceMembershipsForCurrentWorkspace() {
  if (!state.workspace) return [];
  return (state.workspaceMemberships ?? [])
    .filter(item => item.workspace_id === state.workspace.id && !item.archived);
}

function getUsersForCurrentWorkspace() {
  if (!state.workspace) return [];
  const workspaceMemberships = getWorkspaceMembershipsForCurrentWorkspace();
  if (!workspaceMemberships.length) return [];
  const userIds = new Set(workspaceMemberships.map(item => item.user_id));
  return (state.users ?? [])
    .filter(user => user.org_id === state.workspace.org_id && userIds.has(user.id) && !user.archived)
    .sort((a, b) => String(a.display_name ?? '').localeCompare(String(b.display_name ?? '')));
}

function getDefaultTaskAssigneeUserId(workspaceId = null) {
  if (!isAuthenticatedActor()) return null;
  const actorUserId = getAuthState().user?.id ?? null;
  if (!actorUserId) return null;
  const targetWorkspaceId = workspaceId ?? state.workspace?.id ?? null;
  if (!targetWorkspaceId) return null;
  const isActiveMember = (state.workspaceMemberships ?? []).some((membership) =>
    membership.workspace_id === targetWorkspaceId
    && membership.user_id === actorUserId
    && !membership.archived
  );
  return isActiveMember ? actorUserId : null;
}

function getUserDisplayName(userId) {
  if (!userId) return '';
  const user = (state.users ?? []).find(item => item.id === userId);
  return user?.display_name ?? '';
}

function getTaskAssigneeDisplay(task) {
  if (!task) return '';
  if (task.assignee_user_id) {
    return getUserDisplayName(task.assignee_user_id) || task.assignee_label || '';
  }
  return task.assignee_label || '';
}

const ASSIGNEE_SELECT_NONE = '';
const ASSIGNEE_SELECT_EXTERNAL = '__external__';

function getAssigneeSelectValue(assigneeUserId, assigneeLabel) {
  if (assigneeUserId) return assigneeUserId;
  if (assigneeLabel) return ASSIGNEE_SELECT_EXTERNAL;
  return ASSIGNEE_SELECT_NONE;
}

function setAssigneeLabelInputVisibility(selectEl, labelRowEl, labelInputEl, selectedLabel = '') {
  if (!selectEl || !labelRowEl || !labelInputEl) return;
  const showExternal = selectEl.value === ASSIGNEE_SELECT_EXTERNAL;
  labelRowEl.classList.toggle('hidden', !showExternal);
  if (showExternal && !labelInputEl.value && selectedLabel) {
    labelInputEl.value = selectedLabel;
  }
  if (!showExternal) {
    labelInputEl.value = '';
  }
}

function populateAssigneeSelect(selectEl, labelRowEl, labelInputEl, selectedUserId = null, selectedLabel = '') {
  if (!selectEl) return;
  const previousValue = selectEl.value;
  const users = getUsersForCurrentWorkspace();
  const selectedValue = getAssigneeSelectValue(selectedUserId, selectedLabel);
  selectEl.innerHTML = '';

  const noneOption = document.createElement('option');
  noneOption.value = ASSIGNEE_SELECT_NONE;
  noneOption.textContent = 'No assignee';
  selectEl.appendChild(noneOption);

  users.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.display_name;
    selectEl.appendChild(option);
  });
  const hasSelectedUser = Boolean(selectedUserId) && users.some(user => user.id === selectedUserId);
  if (selectedUserId && !hasSelectedUser) {
    const unknownOption = document.createElement('option');
    unknownOption.value = selectedUserId;
    unknownOption.textContent = `Unknown user (${selectedUserId.slice(0, 8)})`;
    selectEl.appendChild(unknownOption);
  }

  const externalOption = document.createElement('option');
  externalOption.value = ASSIGNEE_SELECT_EXTERNAL;
  externalOption.textContent = 'External person...';
  selectEl.appendChild(externalOption);

  const hasSelectedUserOption = Boolean(selectedUserId)
    && Array.from(selectEl.options).some(option => option.value === selectedUserId);
  if (hasSelectedUserOption || selectedValue === ASSIGNEE_SELECT_NONE || selectedValue === ASSIGNEE_SELECT_EXTERNAL) {
    selectEl.value = selectedValue;
  } else if (previousValue && Array.from(selectEl.options).some(option => option.value === previousValue)) {
    selectEl.value = previousValue;
  } else {
    selectEl.value = ASSIGNEE_SELECT_NONE;
  }
  setAssigneeLabelInputVisibility(selectEl, labelRowEl, labelInputEl, selectedLabel);
}

function createWorkflowTemplateAssigneeEditor(task, { locked = false, onSave }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'workflow-assignee-editor';

  const select = document.createElement('select');
  select.className = 'workflow-task-assignee';
  select.disabled = locked;

  const labelRow = document.createElement('span');
  labelRow.className = 'workflow-assignee-label hidden';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'External assignee';
  labelInput.disabled = locked;
  labelRow.appendChild(labelInput);

  populateAssigneeSelect(
    select,
    labelRow,
    labelInput,
    task.assignee_user_id ?? null,
    task.assignee_label ?? ''
  );

  const persistAssignee = () => {
    const selection = select.value ?? ASSIGNEE_SELECT_NONE;
    const assigneeUserId = selection && selection !== ASSIGNEE_SELECT_EXTERNAL
      ? selection
      : null;
    const assigneeLabel = selection === ASSIGNEE_SELECT_EXTERNAL
      ? (labelInput.value?.trim() ?? '')
      : null;
    onSave({
      assignee_user_id: assigneeUserId,
      assignee_label: assigneeLabel || null
    });
  };

  select.addEventListener('change', () => {
    setAssigneeLabelInputVisibility(select, labelRow, labelInput, task.assignee_label ?? '');
    if (select.value !== ASSIGNEE_SELECT_EXTERNAL) {
      persistAssignee();
    }
  });
  labelInput.addEventListener('change', persistAssignee);
  labelInput.addEventListener('blur', () => {
    if (select.value === ASSIGNEE_SELECT_EXTERNAL) {
      persistAssignee();
    }
  });

  wrapper.appendChild(select);
  wrapper.appendChild(labelRow);
  return wrapper;
}

function getActiveShoppingList() {
  if (!state.workspace) return null;
  const allLists = (state.shoppingLists ?? [])
    .filter(list => list.workspace_id === state.workspace.id);
  const activeId = state.ui?.activeShoppingListId ?? null;
  const explicitActive = allLists.find(list => list.id === activeId);
  if (explicitActive) {
    if (isShoppingInboxList(explicitActive) && getShoppingItemsForList(explicitActive.id).length === 0) {
      state.ui = state.ui ?? {};
      state.ui.activeShoppingListId = null;
    } else {
      return explicitActive;
    }
  }
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const visibleLists = allLists.filter(list => shouldShowShoppingListInSidebar(list, { showArchived }));
  const nonInboxVisible = visibleLists.filter((list) => !isShoppingInboxList(list));
  return visibleLists.find(list => !isShoppingInboxList(list) && !list.archived && !isShoppingListComplete(list.id))
    ?? nonInboxVisible[0]
    ?? visibleLists[0]
    ?? allLists.find(list => !list.archived && !isShoppingListClosed(list))
    ?? allLists[0]
    ?? null;
}

function getShoppingItemsForList(listId) {
  if (!listId) return [];
  return Object.values(state.shoppingItems ?? {}).filter(item => item.list_id === listId);
}

function isShoppingListComplete(listId) {
  if (isShoppingInboxListId(listId)) return false;
  const items = getShoppingItemsForList(listId);
  if (!items.length) return false;
  return items.every(item => item.is_checked);
}

function isShoppingListClosed(list) {
  if (!list) return false;
  if (isShoppingInboxList(list)) return false;
  return Boolean(list.archived) || isShoppingListComplete(list.id);
}

function shouldShowShoppingListInSidebar(list, { showArchived = false } = {}) {
  if (!list) return false;
  if (isShoppingInboxList(list)) return getShoppingItemsForList(list.id).length > 0;
  if (showArchived) return true;
  if (list.archived) return false;
  return !isShoppingListComplete(list.id);
}

function getActiveTaskFilter() {
  return state.ui?.activeProjectId ?? null;
}

function getTaskSidebarLists() {
  return getTaskListsForWorkspace()
    .slice()
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

function setActiveTaskFilter(filter) {
  state.ui = state.ui ?? {};
  if (!filter || filter === 'all') {
    state.ui.activeProjectId = null;
    return;
  }
  if (filter === 'inbox') {
    state.ui.activeProjectId = TASK_FILTER_INBOX;
    return;
  }
  if (filter === TASK_FILTER_UNASSIGNED) {
    state.ui.activeProjectId = TASK_FILTER_UNASSIGNED;
    return;
  }
  state.ui.activeProjectId = filter;
}

function getProjectIdFromTaskFilter(activeFilter = getActiveTaskFilter()) {
  if (!activeFilter) return null;
  if (activeFilter === TASK_FILTER_UNASSIGNED) return null;
  if (activeFilter === TASK_FILTER_INBOX) return null;
  return activeFilter;
}

function normalizeGlobalSearchScope(value) {
  if (value === 'projects' || value === 'people' || value === 'workflows') return value;
  return 'tasks';
}

function getGlobalSearchState() {
  state.ui = state.ui ?? {};
  state.ui.globalSearch = state.ui.globalSearch ?? {};
  if (typeof state.ui.globalSearch.query !== 'string') {
    state.ui.globalSearch.query = '';
  }
  state.ui.globalSearch.scope = normalizeGlobalSearchScope(state.ui.globalSearch.scope);
  state.ui.globalSearch.expandTasks = Boolean(state.ui.globalSearch.expandTasks);
  return state.ui.globalSearch;
}

function getGlobalSearchQuery() {
  return getGlobalSearchState().query.trim();
}

function setGlobalSearchQuery(value) {
  const search = getGlobalSearchState();
  const next = String(value ?? '');
  if (search.query === next) return;
  search.query = next;
  search.expandTasks = false;
}

function getGlobalSearchScope() {
  return getGlobalSearchState().scope;
}

function setGlobalSearchScope(value) {
  getGlobalSearchState().scope = normalizeGlobalSearchScope(value);
}

function getGlobalSearchExpandTasks() {
  return Boolean(getGlobalSearchState().expandTasks);
}

function setGlobalSearchExpandTasks(value) {
  getGlobalSearchState().expandTasks = Boolean(value);
}

function openGlobalSearchMenu() {
  if (!globalSearchMenu) return;
  if (openMenu && openMenu !== globalSearchMenu) {
    openMenu.classList.add('hidden');
  }
  globalSearchMenu.classList.remove('hidden');
  openMenu = globalSearchMenu;
}

function closeGlobalSearchMenu() {
  if (!globalSearchMenu) return;
  globalSearchMenu.classList.add('hidden');
  if (openMenu === globalSearchMenu) {
    openMenu = null;
  }
}

function getTextMatchScore(text, needle) {
  const value = String(text ?? '').toLowerCase();
  if (!value || !needle) return Number.MAX_SAFE_INTEGER;
  if (value.startsWith(needle)) return 0;
  if (value.includes(` ${needle}`)) return 1;
  if (value.includes(needle)) return 2;
  return Number.MAX_SAFE_INTEGER;
}

function getGlobalSearchResults(query = getGlobalSearchQuery()) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle || !state.workspace) {
    return { tasks: [], projects: [], people: [], workflows: [] };
  }
  const workspaceId = state.workspace.id;
  const projectsById = new Map(
    getTaskContainersForWorkspace().map((project) => [project.id, project])
  );
  const searchableTasks = Object.values(state.tasks ?? [])
    .filter(task => task.workspace_id === workspaceId && !isWorkflowTaskRecord(task, null))
    .map((task) => {
      const projectName = task.project_id ? (projectsById.get(task.project_id)?.name ?? '') : '';
      const searchText = [
        task.title ?? '',
        task.description_md ?? '',
        normalizeTagList(task.tags).join(' '),
        projectName
      ].join(' ').toLowerCase();
      if (!searchText.includes(needle)) return null;
      const score = Math.min(
        getTextMatchScore(task.title, needle),
        getTextMatchScore(searchText, needle) + 1
      );
      return {
        kind: 'task',
        id: task.id,
        title: task.title ?? 'Untitled task',
        meta: projectName || getStatusLabel(normalizeTaskStatusValue(task.status)) || 'Task',
        score,
        updatedAt: new Date(task.updated_at ?? 0).getTime() || 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));

  const searchableProjects = getProjectsForWorkspace()
    .map((project) => {
      const text = `${project.name ?? ''}`.toLowerCase();
      if (!text.includes(needle)) return null;
      return {
        kind: 'project',
        id: project.id,
        title: project.name ?? 'Untitled project',
        meta: 'Project',
        score: getTextMatchScore(project.name, needle)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  const searchablePeople = getUsersForCurrentWorkspace()
    .map((user) => {
      const text = `${user.display_name ?? ''} ${user.email ?? ''}`.toLowerCase();
      if (!text.includes(needle)) return null;
      return {
        kind: 'person',
        id: user.id,
        title: user.display_name ?? user.email ?? 'Unknown user',
        meta: user.email ?? 'User',
        score: Math.min(
          getTextMatchScore(user.display_name, needle),
          getTextMatchScore(user.email, needle) + 1
        )
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  const searchableWorkflows = getWorkflowsForWorkspace()
    .map((workflow) => {
      const text = `${workflow.name ?? ''} ${workflow.description ?? ''}`.toLowerCase();
      if (!text.includes(needle)) return null;
      return {
        kind: 'workflow',
        id: workflow.id,
        title: workflow.name ?? 'Untitled workflow',
        meta: 'Workflow',
        score: Math.min(
          getTextMatchScore(workflow.name, needle),
          getTextMatchScore(workflow.description, needle) + 1
        )
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  return {
    tasks: searchableTasks,
    projects: searchableProjects,
    people: searchablePeople,
    workflows: searchableWorkflows
  };
}

function handleGlobalSearchResultSelect(kind, id) {
  if (!id) return;
  if (kind === 'task') {
    const task = state.tasks?.[id];
    if (!task) return;
    setActiveView('tasks');
    clearActiveWorkflowChecklistInstanceId();
    if (task.project_id) {
      setActiveTaskFilter(task.project_id);
    } else {
      setActiveTaskFilter('all');
    }
    scheduleTaskSearchRefresh(true);
    render();
    openTaskEditor(id);
    return;
  }
  if (kind === 'project') {
    setActiveTaskFilter(id);
    clearActiveWorkflowChecklistInstanceId();
    setActiveView('tasks');
    scheduleTaskSearchRefresh(true);
    render();
    return;
  }
  if (kind === 'person') {
    openProfile();
    return;
  }
  if (kind === 'workflow') {
    setActiveWorkflowId(id);
    setWorkflowViewMode('runs');
    setActiveView('workflows');
    render();
  }
}

function getGlobalSearchPrimaryResult(results, scope) {
  const orderedScopes = [scope, ...['tasks', 'projects', 'people', 'workflows'].filter(item => item !== scope)];
  for (const key of orderedScopes) {
    const row = (results[key] ?? [])[0];
    if (row) return row;
  }
  return null;
}

function renderGlobalSearch() {
  if (!globalSearchInput || !globalSearchMenu) return;
  const query = getGlobalSearchQuery();
  if (document.activeElement !== globalSearchInput) {
    globalSearchInput.value = query;
  }
  if (!query) {
    globalSearchMenu.innerHTML = '';
    closeGlobalSearchMenu();
    return;
  }

  const results = getGlobalSearchResults(query);
  const total = Object.values(results).reduce((sum, rows) => sum + rows.length, 0);
  const scope = getGlobalSearchScope();
  const tasksExpanded = getGlobalSearchExpandTasks();
  const orderedScopes = [scope, ...['tasks', 'projects', 'people', 'workflows'].filter(item => item !== scope)];
  const scopeLabels = {
    tasks: 'Tasks',
    projects: 'Projects',
    people: 'People',
    workflows: 'Workflows'
  };

  globalSearchMenu.innerHTML = '';

  const scopesRow = document.createElement('div');
  scopesRow.className = 'global-search-scopes';
  Object.entries(scopeLabels).forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `global-search-scope-chip${scope === key ? ' is-active' : ''}`;
    button.dataset.scope = key;
    button.textContent = label;
    scopesRow.appendChild(button);
  });
  globalSearchMenu.appendChild(scopesRow);

  const resultsWrap = document.createElement('div');
  resultsWrap.className = 'global-search-results';

  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'global-search-empty';
    empty.textContent = 'No results found.';
    resultsWrap.appendChild(empty);
  } else {
    orderedScopes.forEach((key) => {
      const rows = results[key] ?? [];
      if (!rows.length) return;
      const section = document.createElement('div');
      section.className = 'global-search-section';
      const title = document.createElement('div');
      title.className = 'global-search-section-title';
      title.textContent = scopeLabels[key];
      section.appendChild(title);
      const limit = key === 'tasks' ? (tasksExpanded ? 15 : 5) : 4;
      rows.slice(0, limit).forEach((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'global-search-result';
        button.dataset.kind = row.kind;
        button.dataset.id = row.id;

        const resultTitle = document.createElement('span');
        resultTitle.className = 'global-search-result-title';
        resultTitle.textContent = row.title;

        const resultMeta = document.createElement('span');
        resultMeta.className = 'global-search-result-meta';
        resultMeta.textContent = row.meta;

        button.appendChild(resultTitle);
        button.appendChild(resultMeta);
        section.appendChild(button);
      });

      if (key === 'tasks' && rows.length > 5) {
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'global-search-toggle-more';
        toggleButton.dataset.action = 'toggle-task-results';
        toggleButton.textContent = tasksExpanded ? 'Show less' : 'Show more tasks';
        section.appendChild(toggleButton);
      }
      resultsWrap.appendChild(section);
    });
  }

  globalSearchMenu.appendChild(resultsWrap);

  const footer = document.createElement('div');
  footer.className = 'global-search-footer';
  const footerButton = document.createElement('button');
  footerButton.type = 'button';
  footerButton.className = 'global-search-footer-button';
  footerButton.dataset.action = 'view-all-results';
  footerButton.textContent = 'View all results';
  footer.appendChild(footerButton);
  globalSearchMenu.appendChild(footer);

  openGlobalSearchMenu();
}

function getTaskSearchText() {
  return String(state.ui?.taskSearchText ?? '').trim();
}

function getTaskTagFilter() {
  return String(state.ui?.taskTagFilter ?? '').trim();
}

function getTaskSearchStatusFilter() {
  const activeFilter = getActiveTaskFilter();
  if (activeFilter !== TASK_FILTER_INBOX) return null;
  return getStatusKeyByKind(TaskStatus.INBOX) ?? TaskStatus.INBOX;
}

function taskMatchesSearchText(task, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${task.title ?? ''} ${task.description_md ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

function taskMatchesTag(task, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return normalizeTagList(task?.tags ?? []).some(tag => tag.toLowerCase().includes(needle));
}

function getTaskSearchResultKey(workspaceId, text, status, tag) {
  return `${workspaceId ?? ''}|${String(text ?? '').trim().toLowerCase()}|${status ?? ''}|${String(tag ?? '').trim().toLowerCase()}`;
}

function clearTaskSearchResult() {
  taskSearchResultIds = null;
  taskSearchResultKey = '';
  taskSearchInFlightKey = '';
}

async function refreshTaskSearchResults() {
  const workspaceId = state.workspace?.id ?? null;
  const text = getTaskSearchText();
  const tag = getTaskTagFilter();
  const status = getTaskSearchStatusFilter();
  const queryKey = getTaskSearchResultKey(workspaceId, text, status, tag);
  if (!workspaceId || (!text && !tag)) {
    clearTaskSearchResult();
    return;
  }

  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (!canUseRemote) {
    clearTaskSearchResult();
    return;
  }

  const requestSeq = ++taskSearchRequestSeq;
  taskSearchInFlightKey = queryKey;
  try {
    const rows = await api.searchTasks({
      workspaceId,
      text,
      status,
      tag
    });
    if (requestSeq !== taskSearchRequestSeq) return;
    const ids = new Set((rows ?? []).map(item => item.id).filter(Boolean));
    taskSearchResultIds = ids;
    taskSearchResultKey = queryKey;
  } catch {
    if (requestSeq !== taskSearchRequestSeq) return;
    clearTaskSearchResult();
    return;
  }
  taskSearchInFlightKey = '';
}

function scheduleTaskSearchRefresh(immediate = false) {
  if (taskSearchDebounceTimer) {
    clearTimeout(taskSearchDebounceTimer);
    taskSearchDebounceTimer = null;
  }
  const run = async () => {
    taskSearchDebounceTimer = null;
    await refreshTaskSearchResults();
    render();
  };
  if (immediate) {
    void run();
    return;
  }
  taskSearchDebounceTimer = setTimeout(() => {
    void run();
  }, 250);
}

function getFilteredTasks() {
  if (!state.workspace) return [];
  const tasks = Object.values(state.tasks).filter(task => task.workspace_id === state.workspace.id);
  const checklistInstanceId = getActiveWorkflowChecklistInstanceId();
  if (checklistInstanceId) {
    const instance = getWorkflowInstanceById(checklistInstanceId);
    if (!instance || instance.workspace_id !== state.workspace.id) {
      clearActiveWorkflowChecklistInstanceId();
    } else {
      const workflowLinksByTaskId = new Map(
        getWorkflowInstanceTasks(checklistInstanceId).map(link => [link.task_id, link])
      );
      return tasks.filter((task) => {
        let current = task;
        let guard = 0;
        while (current && guard < 200) {
          const workflowLink = workflowLinksByTaskId.get(current.id);
          if (workflowLink) return true;
          if (!current.parent_id) return false;
          current = state.tasks?.[current.parent_id] ?? null;
          guard += 1;
        }
        return false;
      });
    }
  }
  const nonWorkflowTasks = tasks.filter(task => !isWorkflowTaskRecord(task, null));
  const filter = getActiveTaskFilter();
  let filtered = nonWorkflowTasks;
  if (filter === TASK_FILTER_UNASSIGNED) {
    filtered = filtered.filter(task => !task.project_id);
  } else if (filter === TASK_FILTER_INBOX) {
    filtered = filtered.filter(task => !task.project_id && isInboxStatusKey(normalizeTaskStatusValue(task.status)));
  } else if (filter) {
    filtered = filtered.filter(task => task.project_id === filter);
  } else {
    // "My Tasks" view excludes project-scoped tasks.
    filtered = filtered.filter(task => !task.project_id);
  }

  const tagFilter = getTaskTagFilter();
  if (tagFilter) {
    filtered = filtered.filter(task => taskMatchesTag(task, tagFilter));
  }

  const query = getTaskSearchText();
  if (!query && !tagFilter) return filtered;
  const queryKey = getTaskSearchResultKey(state.workspace.id, query, getTaskSearchStatusFilter(), tagFilter);
  if (
    navigator.onLine
    && !hasPendingLocalChanges()
    && taskSearchResultKey !== queryKey
    && taskSearchInFlightKey !== queryKey
    && !taskSearchDebounceTimer
  ) {
    scheduleTaskSearchRefresh();
  }
  const localFiltered = filtered.filter(task => taskMatchesSearchText(task, query));
  if (taskSearchResultKey === queryKey && taskSearchResultIds instanceof Set) {
    return localFiltered.filter(task => taskSearchResultIds.has(task.id));
  }
  return localFiltered;
}

function getChecklistLinkForTask(taskId, checklistInstanceId) {
  let currentId = taskId;
  let guard = 0;
  while (currentId && guard < 200) {
    const link = getWorkflowInstanceLinkByTaskId(currentId);
    if (link && (!checklistInstanceId || link.workflow_instance_id === checklistInstanceId)) {
      return link;
    }
    currentId = state.tasks?.[currentId]?.parent_id ?? null;
    guard += 1;
  }
  return null;
}

function renderTaskFilter() {
  if (!taskFilterButton || !taskFilterMenu) return;
  const label = getTaskFilterLabel();
  const checklistViewActive = isWorkflowChecklistViewActive();
  if (taskFilterSearchInput) {
    taskFilterSearchInput.value = getTaskSearchText();
    taskFilterSearchInput.disabled = checklistViewActive;
  }
  if (taskFilterTagInput) {
    taskFilterTagInput.value = getTaskTagFilter();
    taskFilterTagInput.disabled = checklistViewActive;
  }
  taskFilterButton.classList.toggle('task-filter-title', checklistViewActive);
  if (checklistViewActive) {
    taskFilterButton.textContent = label;
    taskFilterButton.setAttribute('aria-haspopup', 'false');
    taskFilterButton.setAttribute('aria-expanded', 'false');
    taskFilterButton.title = label;
    taskFilterMenu.classList.add('hidden');
    if (openMenu === taskFilterMenu) {
      openMenu = null;
    }
    return;
  }
  taskFilterButton.textContent = `${label} ▾`;
  taskFilterButton.setAttribute('aria-haspopup', 'menu');
  taskFilterButton.setAttribute('aria-expanded', 'false');
  taskFilterButton.removeAttribute('title');
}

function getTaskFilterLabel() {
  const checklistInstanceId = getActiveWorkflowChecklistInstanceId();
  if (checklistInstanceId) {
    const instance = getWorkflowInstanceById(checklistInstanceId);
    if (instance) {
      return instance.title;
    }
    return 'Checklist';
  }
  const active = getActiveTaskFilter();
  let label = 'My tasks';
  if (active === TASK_FILTER_UNASSIGNED) {
    return 'Unassigned';
  } else if (active === TASK_FILTER_INBOX) {
    return 'Inbox';
  } else if (active) {
    const project = getTaskContainerById(active);
    label = project?.name ?? 'My tasks';
  }
  return label;
}

function renderTaskTools() {
  const checklistViewActive = isWorkflowChecklistViewActive();
  if (taskAiButton) {
    const aiWrapper = taskAiButton.closest('.task-ai');
    aiWrapper?.classList.toggle('hidden', checklistViewActive);
    if (checklistViewActive) {
      taskAiMenu?.classList.add('hidden');
      if (openMenu === taskAiMenu) openMenu = null;
      taskAiButton.classList.remove('has-count');
      taskAiButton.dataset.count = '';
      taskAiButton.title = 'AI suggestions';
      return;
    }
    const pending = getAiSuggestions().filter(item => item?.task_id && item.decision !== 'rejected').length;
    taskAiButton.classList.toggle('has-count', pending > 0);
    taskAiButton.dataset.count = pending > 0 ? String(pending) : '';
    taskAiButton.title = pending > 0 ? `AI suggestions (${pending})` : 'AI suggestions';
  }
}

function renderTaskShoppingInbox() {
  if (!taskShoppingInbox) return;
  const shouldHide = !state.workspace;
  taskShoppingInbox.classList.toggle('hidden', shouldHide);
}

function renderTaskUiSettings() {
  if (taskUiQuickAddInput) {
    taskUiQuickAddInput.checked = getTaskQuickAddVisible();
  }

  if (taskUiCompletedVisibilitySelect && document.activeElement !== taskUiCompletedVisibilitySelect) {
    taskUiCompletedVisibilitySelect.value = getTaskCompletedVisibility();
  }

  if (taskUiFutureDaysInput && document.activeElement !== taskUiFutureDaysInput) {
    taskUiFutureDaysInput.value = String(getTaskFutureVisibilityDays());
  }

  if (taskUiFilterSelect) {
    const lists = getTaskListsForWorkspace()
      .slice()
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    const projects = getProjectsForWorkspace()
      .slice()
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    const options = [
      { value: 'all', label: 'My tasks' },
      { value: TASK_FILTER_INBOX, label: 'Inbox' },
      { value: TASK_FILTER_UNASSIGNED, label: 'Unassigned' },
      ...lists.map((list) => ({ value: list.id, label: `List: ${list.name}` })),
      ...projects.map((project) => ({ value: project.id, label: `Project: ${project.name}` }))
    ];
    const optionsKey = options.map(option => `${option.value}:${option.label}`).join('|');
    if (taskUiFilterSelect.dataset.optionsKey !== optionsKey) {
      taskUiFilterSelect.innerHTML = '';
      options.forEach(({ value, label }) => {
        const optionEl = document.createElement('option');
        optionEl.value = value;
        optionEl.textContent = label;
        taskUiFilterSelect.appendChild(optionEl);
      });
      taskUiFilterSelect.dataset.optionsKey = optionsKey;
    }
    if (document.activeElement !== taskUiFilterSelect) {
      const currentFilter = getActiveTaskFilter() ?? 'all';
      taskUiFilterSelect.value = currentFilter;
      if (taskUiFilterSelect.value !== currentFilter) {
        taskUiFilterSelect.value = 'all';
      }
    }
  }

  if (taskUiSortSelect && document.activeElement !== taskUiSortSelect) {
    taskUiSortSelect.value = getTaskSortKey();
  }

  if (taskUiGroupSelect && document.activeElement !== taskUiGroupSelect) {
    taskUiGroupSelect.value = getTaskGroupMode();
  }

  if (taskUiViewSelect && document.activeElement !== taskUiViewSelect) {
    taskUiViewSelect.value = getTaskView();
  }

  renderTaskHolidaySettings();
}

function renderSchedulingUiSettings() {
  if (schedulingUiWeekModeSelect && document.activeElement !== schedulingUiWeekModeSelect) {
    schedulingUiWeekModeSelect.value = getSchedulingWeekMode();
  }
  if (schedulingUiTimeZoneInput && document.activeElement !== schedulingUiTimeZoneInput) {
    schedulingUiTimeZoneInput.value = getSchedulingDisplayTimeZone();
  }
  if (schedulingUiDefaultDurationInput && document.activeElement !== schedulingUiDefaultDurationInput) {
    schedulingUiDefaultDurationInput.value = String(getSchedulingDefaultEventDurationMinutes());
  }
}

function renderTaskHolidaySettings() {
  if (!taskUiHolidayList) return;
  const options = US_HOLIDAY_RULES.map(rule => ({ key: rule.key, title: rule.title }));
  const optionsKey = options.map(option => `${option.key}:${option.title}`).join('|');
  if (taskUiHolidayList.dataset.optionsKey !== optionsKey) {
    taskUiHolidayList.innerHTML = '';
    options.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'setting-checkbox setting-checkbox-holiday';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.holidayKey = option.key;
      checkbox.addEventListener('change', () => {
        const key = String(checkbox.dataset.holidayKey ?? '');
        if (!US_HOLIDAY_RULE_KEYS.has(key)) return;
        const hidden = new Set(getCalendarHiddenHolidayKeys());
        if (checkbox.checked) {
          hidden.delete(key);
        } else {
          hidden.add(key);
        }
        setCalendarHiddenHolidayKeys(Array.from(hidden));
        queueUserSettingsSave();
        render();
      });
      const text = document.createElement('span');
      text.textContent = option.title;
      label.appendChild(checkbox);
      label.appendChild(text);
      taskUiHolidayList.appendChild(label);
    });
    taskUiHolidayList.dataset.optionsKey = optionsKey;
  }
  const hidden = new Set(getCalendarHiddenHolidayKeys());
  const checkboxes = taskUiHolidayList.querySelectorAll('input[data-holiday-key]');
  checkboxes.forEach((checkbox) => {
    const key = String(checkbox.dataset.holidayKey ?? '');
    if (document.activeElement === checkbox) return;
    checkbox.checked = !hidden.has(key);
  });
}

function renderTaskSort() {
  if (!taskSortButton || !taskSortMenu) return;
  const key = getTaskSortKey();
  const labelMap = {
    default: 'Sort',
    'due-asc': 'Due date (soonest)',
    'due-desc': 'Due date (latest)'
  };
  taskSortButton.textContent = `${labelMap[key] ?? 'Sort'} ▾`;
}

function renderTaskGroup() {
  if (!taskGroupButton || !taskGroupMenu) return;
  const mode = getTaskGroupMode();
  const labelMap = {
    none: 'Group by',
    section: 'Group by: Section',
    'task-type': 'Group by: Task type',
    priority: 'Group by: Priority'
  };
  taskGroupButton.textContent = `${labelMap[mode] ?? 'Group by'} ▾`;
}

function renderNoticeFilter() {
  if (!noticeFilterButton || !noticeFilterMenu) return;
  const key = getNoticeFilterKey();
  const labelMap = {
    open: 'Open notices',
    closed: 'Closed notices',
    all: 'All notices',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    today: 'Today'
  };
  noticeFilterButton.textContent = `${labelMap[key] ?? 'All notices'} ▾`;
}

function renderProjectFilter() {
  if (!projectFilterButton || !projectFilterMenu) return;
  const key = getProjectFilterKey();
  const labelMap = {
    open: 'Open projects',
    closed: 'Closed projects',
    all: 'All projects'
  };
  projectFilterButton.textContent = `${labelMap[key] ?? 'Open projects'} ▾`;
}

function renderShoppingFilter() {
  if (!shoppingFilterButton || !shoppingFilterMenu) return;
  const key = getShoppingFilterKey();
  const labelMap = {
    open: 'Open lists',
    closed: 'Completed lists',
    all: 'All lists'
  };
  shoppingFilterButton.textContent = `${labelMap[key] ?? 'Open lists'} ▾`;
}

function renderNoticeSort() {
  if (!noticeSortButton || !noticeSortMenu) return;
  const key = getNoticeSortKey();
  const labelMap = {
    'time-asc': 'Soonest',
    'time-desc': 'Latest',
    'title-asc': 'Title (A–Z)'
  };
  noticeSortButton.textContent = `${labelMap[key] ?? 'Sort'} ▾`;
}

function getAccountDisplayName() {
  const name = state.workspace?.name?.trim();
  return name || 'Organization';
}

function getProfileState() {
  const authUser = state.ui?.auth?.user;
  if (authUser && typeof authUser === 'object') {
    return {
      name: authUser.display_name ?? '',
      email: authUser.email ?? ''
    };
  }
  const profile = state.ui?.profile;
  if (!profile || typeof profile !== 'object') return {};
  return profile;
}

function getProfileDisplayName() {
  const name = String(getProfileState().name ?? '').trim();
  return name || getAccountDisplayName();
}

function getProfileEmail() {
  const email = String(getProfileState().email ?? '').trim();
  return email || 'you@example.com';
}

function normalizeActorEmail(email) {
  const text = String(email ?? '').trim().toLowerCase();
  if (!text) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '';
  return text;
}

function normalizeOrgRole(role) {
  return String(role ?? '').trim().toLowerCase() === 'admin' ? 'admin' : 'member';
}

function isOwnerEmail(email, ownerEmail) {
  const normalizedEmail = normalizeActorEmail(email);
  const normalizedOwner = normalizeActorEmail(ownerEmail);
  return Boolean(normalizedEmail && normalizedOwner && normalizedEmail === normalizedOwner);
}

function getAuthState() {
  state.ui = state.ui ?? {};
  if (!state.ui.auth || typeof state.ui.auth !== 'object') {
    state.ui.auth = {
      authenticated: false,
      requireAuth: false,
      user: null,
      session: null,
      workspaces: [],
      ownerEmail: DEFAULT_OWNER_EMAIL,
      isOwner: false,
      isAdmin: false
    };
  }
  return state.ui.auth;
}

function isAuthGateEnabled() {
  return Boolean(getAuthState().requireAuth);
}

function isAuthenticatedActor() {
  const auth = getAuthState();
  return Boolean(auth.authenticated && auth.user?.id);
}

function shouldShowAuthGatePage() {
  return (isAuthGateEnabled() || Boolean(state.ui?.forceAuthGate)) && !isAuthenticatedActor();
}

function syncAuthGatePage() {
  const authGated = shouldShowAuthGatePage();
  document.body.classList.toggle('auth-gated', authGated);
  if (authGated && authModal?.classList.contains('hidden')) {
    authModal.classList.remove('hidden');
  }
}

function getInviteTokenFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return String(params.get('invite_token') ?? '').trim();
}

function clearInviteTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite_token')) return;
  url.searchParams.delete('invite_token');
  window.history.replaceState(window.history.state ?? null, '', `${url.pathname}${url.search}${url.hash}`);
}

function setAuthStatus(message = '', tone = '') {
  if (!authStatus) return;
  authStatus.textContent = String(message ?? '');
  if (tone) {
    authStatus.dataset.tone = tone;
  } else {
    delete authStatus.dataset.tone;
  }
}

function setAuthModalMode(mode = 'login') {
  authModalMode = mode === 'invite' ? 'invite' : 'login';
  if (authLoginForm) {
    const isLogin = authModalMode === 'login';
    authLoginForm.classList.toggle('hidden', !isLogin);
    authLoginForm.hidden = !isLogin;
    authLoginForm.setAttribute('aria-hidden', isLogin ? 'false' : 'true');
  }
  if (authInviteForm) {
    const isInvite = authModalMode === 'invite';
    authInviteForm.classList.toggle('hidden', !isInvite);
    authInviteForm.hidden = !isInvite;
    authInviteForm.setAttribute('aria-hidden', isInvite ? 'false' : 'true');
  }
  if (authModalTitle) {
    authModalTitle.textContent = authModalMode === 'invite' ? 'Accept invite' : 'Sign in';
  }
  if (authModalMode === 'invite') {
    authInviteToken?.focus();
  } else {
    authLoginEmail?.focus();
  }
}

function openAuthModal(mode = 'login', { inviteToken = '' } = {}) {
  if (!authModal) return;
  setAuthStatus('');
  if (inviteToken && authInviteToken && !authInviteToken.value) {
    authInviteToken.value = inviteToken;
  }
  setAuthModalMode(mode);
  authModal.classList.remove('hidden');
}

function closeAuthModal() {
  if (shouldShowAuthGatePage()) return;
  authModal?.classList.add('hidden');
  setAuthStatus('');
}

function applyAuthPayload(payload, { persistProfile = true } = {}) {
  const auth = getAuthState();
  const user = payload?.user && typeof payload.user === 'object' ? payload.user : null;
  const session = payload?.session && typeof payload.session === 'object' ? payload.session : null;
  const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
  const ownerEmail = normalizeActorEmail(payload?.owner_email ?? '') || auth.ownerEmail || DEFAULT_OWNER_EMAIL;
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'require_auth')) {
    auth.requireAuth = Boolean(payload.require_auth);
  }
  auth.authenticated = Boolean(payload?.authenticated && user?.id);
  auth.user = auth.authenticated ? {
    id: user.id,
    org_id: user.org_id,
    display_name: user.display_name,
    email: user.email,
    org_role: user.org_role ?? 'member'
  } : null;
  auth.session = auth.authenticated ? {
    id: session?.id ?? null,
    expires_at: session?.expires_at ?? null
  } : null;
  auth.workspaces = workspaces;
  auth.ownerEmail = ownerEmail;
  auth.isOwner = Boolean(payload?.is_owner && auth.authenticated);
  auth.isAdmin = Boolean(
    auth.authenticated
    && (payload?.is_admin ?? (auth.isOwner || normalizeOrgRole(user?.org_role) === 'admin'))
  );
  if (persistProfile) {
    state.ui.profile = auth.user
      ? { name: auth.user.display_name, email: auth.user.email }
      : { name: '', email: '' };
  }
  if (!auth.authenticated) {
    applyUserSettingsPayload(null);
  }
}

function getDefaultUserSettings() {
  return {
    notifications_enabled: false,
    checkin_extend_minutes: 60,
    task_ui: {
      quick_add_visible: true,
      completed_visibility: 'show',
      future_visibility_days: 0,
      default_filter: 'all',
      default_sort: 'default',
      default_group: 'none',
      default_view: 'list',
      hidden_holiday_keys: []
    },
    scheduling_ui: {
      show_tasks: false,
      week_mode: 'seven',
      time_zone: getSystemTimeZone(),
      default_event_duration_minutes: DEFAULT_SCHEDULE_EVENT_DURATION_MINUTES,
      hidden_kinds: [],
      hidden_calendar_ids: []
    }
  };
}

function normalizeUserSettings(settings) {
  const defaults = getDefaultUserSettings();
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const taskUi = source.task_ui && typeof source.task_ui === 'object' && !Array.isArray(source.task_ui)
    ? source.task_ui
    : {};
  const schedulingUi = source.scheduling_ui && typeof source.scheduling_ui === 'object' && !Array.isArray(source.scheduling_ui)
    ? source.scheduling_ui
    : {};
  const normalizeHiddenCalendarIds = (value) => {
    if (!Array.isArray(value)) return [...defaults.scheduling_ui.hidden_calendar_ids];
    const seen = new Set();
    const ids = [];
    value.forEach((entry) => {
      const id = String(entry ?? '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  };
  const normalized = {
    notifications_enabled: Boolean(source.notifications_enabled),
    checkin_extend_minutes: Number(source.checkin_extend_minutes),
    task_ui: {
      quick_add_visible: taskUi.quick_add_visible !== undefined
        ? Boolean(taskUi.quick_add_visible)
        : defaults.task_ui.quick_add_visible,
      completed_visibility: taskUi.completed_visibility === 'hide' ? 'hide' : 'show',
      future_visibility_days: Number.isFinite(Number(taskUi.future_visibility_days)) && Number(taskUi.future_visibility_days) >= 0
        ? Math.floor(Number(taskUi.future_visibility_days))
        : defaults.task_ui.future_visibility_days,
      default_filter: String(taskUi.default_filter ?? defaults.task_ui.default_filter),
      default_sort: String(taskUi.default_sort ?? defaults.task_ui.default_sort),
      default_group: String(taskUi.default_group ?? defaults.task_ui.default_group),
      default_view: String(taskUi.default_view ?? defaults.task_ui.default_view),
      hidden_holiday_keys: normalizeHiddenHolidayKeys(taskUi.hidden_holiday_keys ?? defaults.task_ui.hidden_holiday_keys)
    },
    scheduling_ui: {
      show_tasks: schedulingUi.show_tasks !== undefined
        ? Boolean(schedulingUi.show_tasks)
        : defaults.scheduling_ui.show_tasks,
      week_mode: schedulingUi.week_mode === 'workweek' ? 'workweek' : 'seven',
      time_zone: normalizeTimeZone(schedulingUi.time_zone ?? defaults.scheduling_ui.time_zone),
      default_event_duration_minutes: normalizeSchedulingDefaultEventDurationMinutes(
        schedulingUi.default_event_duration_minutes ?? defaults.scheduling_ui.default_event_duration_minutes
      ),
      hidden_kinds: normalizeSchedulingHiddenKinds(schedulingUi.hidden_kinds ?? defaults.scheduling_ui.hidden_kinds),
      hidden_calendar_ids: normalizeHiddenCalendarIds(
        schedulingUi.hidden_calendar_ids ?? defaults.scheduling_ui.hidden_calendar_ids
      )
    }
  };
  if (!Number.isFinite(normalized.checkin_extend_minutes) || normalized.checkin_extend_minutes <= 0) {
    normalized.checkin_extend_minutes = defaults.checkin_extend_minutes;
  }
  return normalized;
}

function buildUserSettingsPayload() {
  return normalizeUserSettings({
    notifications_enabled: Boolean(state.ui?.notificationsEnabled),
    checkin_extend_minutes: getCheckinExtendMinutes(),
    task_ui: {
      quick_add_visible: getTaskQuickAddVisible(),
      completed_visibility: getTaskCompletedVisibility(),
      future_visibility_days: getTaskFutureVisibilityDays(),
      default_filter: getActiveTaskFilter(),
      default_sort: getTaskSortKey(),
      default_group: getTaskGroupMode(),
      default_view: getTaskView(),
      hidden_holiday_keys: getCalendarHiddenHolidayKeys()
    },
    scheduling_ui: {
      show_tasks: getSchedulingShowTasks(),
      week_mode: getSchedulingWeekMode(),
      time_zone: getSchedulingDisplayTimeZone(),
      default_event_duration_minutes: getSchedulingDefaultEventDurationMinutes(),
      hidden_kinds: getSchedulingHiddenKinds(),
      hidden_calendar_ids: getSchedulingHiddenCalendarIds()
    }
  });
}

function applyUserSettingsPayload(settings) {
  const next = normalizeUserSettings(settings);
  state.ui = state.ui ?? {};
  state.ui.notificationsEnabled = next.notifications_enabled;
  setCheckinExtendMinutes(next.checkin_extend_minutes);
  setTaskQuickAddVisible(next.task_ui.quick_add_visible);
  setTaskCompletedVisibility(next.task_ui.completed_visibility);
  setTaskFutureVisibilityDays(next.task_ui.future_visibility_days);
  setActiveTaskFilter(next.task_ui.default_filter);
  setTaskSortKey(next.task_ui.default_sort);
  setTaskGroupMode(next.task_ui.default_group);
  setTaskView(next.task_ui.default_view);
  setCalendarHiddenHolidayKeys(next.task_ui.hidden_holiday_keys);
  setSchedulingShowTasks(next.scheduling_ui.show_tasks);
  setSchedulingWeekMode(next.scheduling_ui.week_mode);
  setSchedulingDisplayTimeZone(next.scheduling_ui.time_zone);
  setSchedulingDefaultEventDurationMinutes(next.scheduling_ui.default_event_duration_minutes);
  state.ui.schedulingHiddenKinds = normalizeSchedulingHiddenKinds(next.scheduling_ui.hidden_kinds);
  state.ui.schedulingHiddenCalendarIds = next.scheduling_ui.hidden_calendar_ids;
}

async function hydrateUserSettingsFromServer() {
  if (!isAuthenticatedActor()) {
    applyUserSettingsPayload(null);
    return;
  }
  try {
    const response = await api.getAuthSettings();
    applyUserSettingsPayload(response?.settings ?? null);
  } catch {
    applyUserSettingsPayload(null);
  }
}

function queueUserSettingsSave({ immediate = false } = {}) {
  if (!isAuthenticatedActor()) return;
  if (userSettingsSaveTimer) {
    clearTimeout(userSettingsSaveTimer);
    userSettingsSaveTimer = null;
  }
  const run = async () => {
    userSettingsSaveTimer = null;
    try {
      await api.updateAuthSettings({ settings: buildUserSettingsPayload() });
    } catch {
      // Keep UI responsive; settings save can retry on next change.
    }
  };
  if (immediate) {
    void run();
    return;
  }
  userSettingsSaveTimer = setTimeout(() => {
    void run();
  }, USER_SETTINGS_SAVE_DEBOUNCE_MS);
}

function clearWorkspaceDomainData() {
  // Keep local domain data intact; auth gating should hide UI, not erase local state.
  state.workspace = null;
  if (activeTaskId) {
    closeTaskEditor();
  }
  state.ui = state.ui ?? {};
  state.ui.activeWorkspaceId = null;
  state.ui.activeProjectId = null;
  state.ui.activeShoppingListId = null;
  state.ui.activeWorkflowId = null;
  state.ui.activeNoticeId = null;
}

async function hydrateAuthSession() {
  try {
    const session = await api.getAuthMe();
    applyAuthPayload(session, { persistProfile: true });
    await hydrateUserSettingsFromServer();
  } catch {
    applyAuthPayload({ authenticated: false }, { persistProfile: false });
    applyUserSettingsPayload(null);
  }
}

async function reloadWorkspaceAfterAuthChange() {
  await hydrateUserSettingsFromServer();
  await loadWorkspaces();
  await refreshWorkspace();
  await primeSyncCursor();
}

async function submitAuthLogin() {
  if (!authLoginEmail || !authLoginPassword) return;
  const email = normalizeActorEmail(authLoginEmail.value);
  if (!email) {
    setAuthStatus('Enter a valid email address.', 'error');
    authLoginEmail.focus();
    return;
  }
  const password = String(authLoginPassword.value ?? '');
  if (!password) {
    setAuthStatus('Password is required.', 'error');
    authLoginPassword.focus();
    return;
  }
  try {
    const payload = await api.login({ email, password });
    applyAuthPayload(payload, { persistProfile: true });
    state.ui = state.ui ?? {};
    state.ui.forceAuthGate = false;
    authLoginPassword.value = '';
    closeAuthModal();
    await reloadWorkspaceAfterAuthChange();
    setActiveView('tasks');
    render();
    showToast({ type: 'success', message: 'Signed in.' });
  } catch (err) {
    setAuthStatus(err?.message ?? 'Login failed.', 'error');
  }
}

async function submitInviteAccept() {
  if (!authInviteToken || !authInviteEmail || !authInviteName || !authInvitePassword) return;
  const inviteToken = String(authInviteToken.value ?? '').trim();
  const email = normalizeActorEmail(authInviteEmail.value);
  const displayName = normalizeTitleInput(authInviteName.value);
  const password = String(authInvitePassword.value ?? '');
  if (!inviteToken) {
    setAuthStatus('Invite token is required.', 'error');
    authInviteToken.focus();
    return;
  }
  if (!email) {
    setAuthStatus('Enter a valid email address.', 'error');
    authInviteEmail.focus();
    return;
  }
  if (!displayName) {
    setAuthStatus('Full name is required.', 'error');
    authInviteName.focus();
    return;
  }
  if (!password) {
    setAuthStatus('Password is required.', 'error');
    authInvitePassword.focus();
    return;
  }
  try {
    const payload = await api.acceptInvite({
      invite_token: inviteToken,
      email,
      display_name: displayName,
      password
    });
    applyAuthPayload(payload, { persistProfile: true });
    state.ui = state.ui ?? {};
    state.ui.forceAuthGate = false;
    authInvitePassword.value = '';
    clearInviteTokenFromUrl();
    closeAuthModal();
    await reloadWorkspaceAfterAuthChange();
    setActiveView('tasks');
    render();
    showToast({ type: 'success', message: 'Account created and signed in.' });
  } catch (err) {
    setAuthStatus(err?.message ?? 'Could not accept invite.', 'error');
  }
}

async function handleAccountAuthAction() {
  if (isAuthenticatedActor()) {
    try {
      await api.logout();
    } catch {
      // Clear local auth state even if server logout fails.
    }
    if (userSettingsSaveTimer) {
      clearTimeout(userSettingsSaveTimer);
      userSettingsSaveTimer = null;
    }
    state.ui = state.ui ?? {};
    state.ui.forceAuthGate = true;
    applyAuthPayload({ authenticated: false }, { persistProfile: true });
    if (isAuthGateEnabled()) {
      clearWorkspaceDomainData();
      openAuthModal('login');
    } else {
      await reloadWorkspaceAfterAuthChange();
    }
    render();
    showToast({ type: 'info', message: 'Signed out.' });
    return;
  }
  openAuthModal('login');
}

function getCurrentOwnerEmail() {
  const auth = getAuthState();
  return normalizeActorEmail(auth.ownerEmail) || DEFAULT_OWNER_EMAIL;
}

function isCurrentActorOwnerSuperAdmin() {
  return Boolean(getAuthState().isOwner);
}

function isCurrentActorAdmin() {
  return Boolean(getAuthState().isAdmin || getAuthState().isOwner);
}

function getAccountInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'BH';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function renderAccountMenu() {
  const orgName = getAccountDisplayName();
  const profileName = getProfileDisplayName();
  const initials = getAccountInitials(profileName);
  const email = getProfileEmail();
  const authenticated = isAuthenticatedActor();
  [accountAvatar, accountListAvatar, accountProfileAvatar].forEach((el) => {
    if (el) el.textContent = initials;
  });
  if (accountListName) accountListName.textContent = orgName;
  if (accountProfileName) accountProfileName.textContent = profileName;
  if (accountProfileEmail) accountProfileEmail.textContent = email;
  if (accountLogout) accountLogout.textContent = authenticated ? 'Log out' : 'Log in';
  if (mobileMenuAuth) mobileMenuAuth.textContent = authenticated ? 'Log out' : 'Log in';
  if (accountAdmin) {
    accountAdmin.classList.toggle('hidden', !isCurrentActorAdmin());
  }
}

function getWorkspaceTypeLabel() {
  const raw = String(state.workspace?.type ?? 'personal').trim();
  if (!raw) return 'Personal';
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderProfilePage() {
  if (!profilePage) return;
  const name = getProfileDisplayName();
  const email = getProfileEmail();
  const initials = getAccountInitials(name);
  if (profilePageAvatar) profilePageAvatar.textContent = initials;
  if (profilePageSummaryName) profilePageSummaryName.textContent = name;
  if (profilePageSummaryEmail) profilePageSummaryEmail.textContent = email;
  if (profilePageName && document.activeElement !== profilePageName) {
    profilePageName.value = name;
  }
  if (profilePageEmail && document.activeElement !== profilePageEmail) {
    profilePageEmail.value = email;
  }
  if (profilePageWorkspace) {
    profilePageWorkspace.textContent = state.workspace?.name?.trim() || 'No active workspace';
  }
  if (profilePageWorkspaceType) {
    profilePageWorkspaceType.textContent = getWorkspaceTypeLabel();
  }
}

async function saveProfilePage() {
  if (!profilePageName || !profilePageEmail) return;
  const name = normalizeTitleInput(profilePageName.value);
  if (!name) {
    alert('Display name is required.');
    profilePageName.focus();
    return;
  }
  const email = String(profilePageEmail.value ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('Enter a valid email address.');
    profilePageEmail.focus();
    return;
  }
  if (!isAuthenticatedActor()) {
    state.ui = state.ui ?? {};
    state.ui.profile = { name, email };
    render();
    return;
  }
  try {
    const response = await api.updateAuthProfile({
      display_name: name,
      email: email || null
    });
    const updatedUser = response?.user;
    if (updatedUser?.id) {
      const auth = getAuthState();
      auth.user = {
        ...auth.user,
        ...updatedUser
      };
      if (response?.owner_email) {
        auth.ownerEmail = normalizeActorEmail(response.owner_email) || auth.ownerEmail;
        auth.isOwner = isOwnerEmail(auth.user?.email, auth.ownerEmail);
        auth.isAdmin = auth.isOwner || normalizeOrgRole(auth.user?.org_role) === 'admin';
      }
      upsertUser(updatedUser);
    }
    state.ui.profile = { name, email };
    appendCrudEvent({
      source: 'profile',
      event: 'updated',
      entity_type: 'profile',
      entity_id: 'self',
      data: { name, email }
    });
    render();
    showToast({ type: 'success', message: 'Profile updated.' });
  } catch (err) {
    showToast({ type: 'error', message: err?.message ?? 'Unable to update profile.' });
  }
}

function getAdminState() {
  state.ui = state.ui ?? {};
  if (!state.ui.admin || typeof state.ui.admin !== 'object') {
    state.ui.admin = {};
  }
  const adminState = state.ui.admin;
  if (!Array.isArray(adminState.invites)) adminState.invites = [];
  if (!Array.isArray(adminState.users)) adminState.users = [];
  if (typeof adminState.invitesLoading !== 'boolean') adminState.invitesLoading = false;
  if (typeof adminState.usersLoading !== 'boolean') adminState.usersLoading = false;
  if (typeof adminState.invitesError !== 'string') adminState.invitesError = '';
  if (typeof adminState.usersError !== 'string') adminState.usersError = '';
  if (typeof adminState.invitesLoaded !== 'boolean') adminState.invitesLoaded = false;
  if (typeof adminState.usersLoaded !== 'boolean') adminState.usersLoaded = false;
  if (!Number.isFinite(Number(adminState.invitesRequestedAt))) adminState.invitesRequestedAt = 0;
  if (!Number.isFinite(Number(adminState.usersRequestedAt))) adminState.usersRequestedAt = 0;
  if (typeof adminState.ownerEmail !== 'string') adminState.ownerEmail = getCurrentOwnerEmail();
  if (typeof adminState.statusMessage !== 'string') adminState.statusMessage = '';
  if (typeof adminState.statusTone !== 'string') adminState.statusTone = 'info';
  if (typeof adminState.selectedUserId !== 'string') adminState.selectedUserId = '';
  return adminState;
}

function syncAdminOwnerEmail(ownerEmail) {
  const normalizedOwnerEmail = normalizeActorEmail(ownerEmail);
  if (!normalizedOwnerEmail) return;
  const adminState = getAdminState();
  adminState.ownerEmail = normalizedOwnerEmail;
  const auth = getAuthState();
  auth.ownerEmail = normalizedOwnerEmail;
  auth.isOwner = isOwnerEmail(auth.user?.email, normalizedOwnerEmail);
  auth.isAdmin = auth.isOwner || normalizeOrgRole(auth.user?.org_role) === 'admin';
  renderAccountMenu();
}

function getSelectedAdminUser() {
  const adminState = getAdminState();
  if (!adminState.selectedUserId) return null;
  return adminState.users.find((user) => user.id === adminState.selectedUserId) ?? null;
}

function setAdminInviteToken(token = '') {
  if (!adminInviteTokenWrap || !adminInviteToken) return;
  const safeToken = String(token ?? '').trim();
  adminInviteToken.value = safeToken;
  adminInviteTokenWrap.classList.toggle('hidden', !safeToken);
}

function setAdminInviteStatus(message, type = 'info') {
  if (!adminInviteStatus) return;
  adminInviteStatus.textContent = message;
  adminInviteStatus.dataset.pinned = type === 'info' ? '' : '1';
}

function setAdminUsersStatus(message, tone = 'info') {
  if (!adminUsersStatus) return;
  adminUsersStatus.textContent = String(message ?? '');
  if (tone) {
    adminUsersStatus.dataset.tone = tone;
  } else {
    delete adminUsersStatus.dataset.tone;
  }
}

function buildInviteLinkFromToken(token) {
  const safeToken = String(token ?? '').trim();
  if (!safeToken || typeof window === 'undefined') return '';
  const base = window.location.origin.replace(/\/$/, '');
  return `${base}/apps/web/?invite_token=${encodeURIComponent(safeToken)}`;
}

async function copyInviteLinkToClipboard(token) {
  const inviteUrl = buildInviteLinkFromToken(token);
  if (!inviteUrl) {
    setAdminInviteStatus('No invite token available.', 'error');
    showToast({ type: 'error', message: 'No invite link available to copy.' });
    return false;
  }
  try {
    await navigator.clipboard.writeText(inviteUrl);
    setAdminInviteStatus('Invite link copied to clipboard.');
    showToast({ type: 'success', message: 'Invite link copied to clipboard.' });
    return true;
  } catch {
    setAdminInviteStatus('Could not copy invite link. Copy it manually from the token field.', 'error');
    showToast({ type: 'error', message: 'Could not copy invite link.' });
    return false;
  }
}

function renderAdminInvitesList() {
  if (!adminInvitesList) return;
  const adminState = getAdminState();
  adminInvitesList.innerHTML = '';
  if (adminState.invitesLoading) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Loading invites...';
    adminInvitesList.appendChild(note);
    return;
  }
  if (adminState.invitesError) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = adminState.invitesError;
    adminInvitesList.appendChild(note);
    return;
  }
  const invites = Array.isArray(adminState.invites) ? adminState.invites : [];
  if (!invites.length) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'No pending invites.';
    adminInvitesList.appendChild(note);
    return;
  }
  invites.forEach((invite) => {
    const inviteId = String(invite?.id ?? '').trim();
    if (!inviteId) return;
    const row = document.createElement('div');
    row.className = 'workspace-row notice-row';
    const info = document.createElement('div');
    info.className = 'notice-row-info';
    const title = document.createElement('div');
    title.className = 'notice-row-title';
    title.textContent = invite.email;
    const meta = document.createElement('div');
    meta.className = 'notice-row-meta';
    const workspaceName = invite.workspace_name ? ` • ${invite.workspace_name}` : '';
    const inviteStatus = String(invite.status ?? 'pending').toLowerCase();
    meta.textContent = `${inviteStatus} • ${invite.role} • expires ${formatNoticeDateTimeDisplay(invite.expires_at)}${workspaceName}`;
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'admin-invite-row-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'subtle-button admin-invite-copy-link';
    copyBtn.textContent = 'Copy link';
    const inviteToken = String(invite.invite_token ?? '').trim();
    if (inviteToken) {
      copyBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await copyInviteLinkToClipboard(inviteToken);
      });
    } else {
      copyBtn.disabled = true;
      copyBtn.title = 'Token not available for this invite';
    }
    actions.appendChild(copyBtn);
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'subtle-button admin-invite-delete-link';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deletePendingInvite(invite);
    });
    actions.appendChild(deleteBtn);
    row.appendChild(actions);
    adminInvitesList.appendChild(row);
  });
}

function renderAdminUsersList() {
  if (!adminUsersList) return;
  const adminState = getAdminState();
  adminUsersList.innerHTML = '';
  if (adminState.usersLoading) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Loading users...';
    adminUsersList.appendChild(note);
    return;
  }
  if (adminState.usersError) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = adminState.usersError;
    adminUsersList.appendChild(note);
    return;
  }
  if (!adminState.users.length) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'No users found.';
    adminUsersList.appendChild(note);
    return;
  }
  adminState.users.forEach((user) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'workspace-row notice-row admin-user-row';
    row.classList.toggle('active', user.id === adminState.selectedUserId);
    row.addEventListener('click', () => {
      adminState.selectedUserId = user.id;
      renderAdminUsersList();
      renderAdminUserEditor();
    });

    const info = document.createElement('div');
    info.className = 'notice-row-info';
    const title = document.createElement('div');
    title.className = 'notice-row-title';
    title.textContent = user.display_name || user.email;
    const meta = document.createElement('div');
    meta.className = 'notice-row-meta';
    const roleLabel = user.is_owner ? 'owner' : (user.org_role ?? 'member');
    const stateLabel = Number(user.archived) ? 'disabled' : 'active';
    meta.textContent = `${user.email} • ${roleLabel} • ${stateLabel}`;
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(info);
    adminUsersList.appendChild(row);
  });
}

function renderAdminUserEditor() {
  const adminState = getAdminState();
  const users = adminState.users ?? [];
  if (adminUserSelect) {
    const currentOptionsKey = users.map((user) => `${user.id}:${user.email}`).join('|');
    if (adminUserSelect.dataset.optionsKey !== currentOptionsKey) {
      adminUserSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = users.length ? 'Select user' : 'No users';
      adminUserSelect.appendChild(placeholder);
      users.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.display_name || user.email} (${user.email})`;
        adminUserSelect.appendChild(option);
      });
      adminUserSelect.dataset.optionsKey = currentOptionsKey;
    }
    adminUserSelect.value = adminState.selectedUserId || '';
  }

  const selected = getSelectedAdminUser();
  const ownerEmail = normalizeActorEmail(adminState.ownerEmail || getCurrentOwnerEmail());
  const isOwnerActor = isCurrentActorOwnerSuperAdmin();
  const canEditSelected = Boolean(selected);
  const selectedIsOwner = Boolean(selected?.is_owner || isOwnerEmail(selected?.email, ownerEmail));
  const canEditRole = Boolean(canEditSelected && isOwnerActor && !selectedIsOwner);

  if (adminUserName && document.activeElement !== adminUserName) {
    adminUserName.value = selected?.display_name ?? '';
  }
  if (adminUserEmail && document.activeElement !== adminUserEmail) {
    adminUserEmail.value = selected?.email ?? '';
  }
  if (adminUserRole) {
    if (selected) {
      adminUserRole.value = normalizeOrgRole(selected.org_role);
    } else {
      adminUserRole.value = 'member';
    }
    adminUserRole.disabled = !canEditRole;
  }
  if (adminUserArchived) {
    adminUserArchived.value = selected ? (Number(selected.archived) ? '1' : '0') : '0';
    adminUserArchived.disabled = !canEditSelected || selectedIsOwner;
  }
  if (adminUserSettings && document.activeElement !== adminUserSettings) {
    adminUserSettings.value = selected
      ? JSON.stringify(selected.settings ?? {}, null, 2)
      : '{}';
  }
  if (adminUserPassword) {
    adminUserPassword.disabled = !canEditSelected;
  }
  if (adminUserSave) adminUserSave.disabled = !canEditSelected;
  if (adminUserPasswordReset) adminUserPasswordReset.disabled = !canEditSelected || (!isOwnerActor && selectedIsOwner);
  if (adminUserExport) adminUserExport.disabled = !canEditSelected;
  if (adminUserDelete) adminUserDelete.disabled = !canEditSelected || selectedIsOwner;
  if (adminOwnershipTransfer) {
    adminOwnershipTransfer.disabled = !canEditSelected || !isOwnerActor || selectedIsOwner;
    adminOwnershipTransfer.classList.toggle('hidden', !isOwnerActor);
  }
}

function renderAdminPage() {
  if (!adminPage) return;
  if (adminInviteRole) {
    if (!adminInviteRole.value) {
      adminInviteRole.value = 'member';
    }
    const canInviteAdmins = isCurrentActorOwnerSuperAdmin();
    const adminRoleOption = Array.from(adminInviteRole.options ?? []).find((option) => option.value === 'admin');
    if (adminRoleOption) {
      adminRoleOption.disabled = !canInviteAdmins;
    }
    if (!canInviteAdmins && adminInviteRole.value === 'admin') {
      adminInviteRole.value = 'member';
    }
  }
  if (adminInviteStatus && !adminInviteStatus.dataset.pinned) {
    const roleLabel = isCurrentActorOwnerSuperAdmin() ? 'Owner' : (isCurrentActorAdmin() ? 'Admin' : 'Member');
    const ownerEmail = normalizeActorEmail(getAdminState().ownerEmail || getCurrentOwnerEmail());
    adminInviteStatus.textContent = `${roleLabel} console • owner ${ownerEmail}`;
  }
  renderAdminInvitesList();
  renderAdminUsersList();
  renderAdminUserEditor();

  if (getActiveView() !== 'admin') return;
  const adminState = getAdminState();
  const now = Date.now();
  if (!adminState.invitesLoading && (!adminState.invitesLoaded || now - Number(adminState.invitesRequestedAt ?? 0) > ADMIN_INVITES_AUTO_REFRESH_MS)) {
    void refreshAdminInvites();
  }
  if (!adminState.usersLoading && (!adminState.usersLoaded || now - Number(adminState.usersRequestedAt ?? 0) > ADMIN_USERS_AUTO_REFRESH_MS)) {
    void refreshAdminUsers();
  }
}

async function refreshAdminInvites() {
  const adminState = getAdminState();
  if (adminState.invitesLoading) return;
  const workspaceId = state.workspace?.id || null;
  if (!workspaceId) {
    adminState.invites = [];
    adminState.invitesError = 'Select an active workspace to manage pending invites.';
    adminState.invitesLoading = false;
    adminState.invitesLoaded = true;
    renderAdminInvitesList();
    return;
  }
  adminState.invitesRequestedAt = Date.now();
  adminState.invitesLoading = true;
  adminState.invitesError = '';
  renderAdminInvitesList();
  try {
    const response = await api.listAdminInvites({ workspaceId, status: 'pending' });
    adminState.invites = response?.invites ?? [];
  } catch (err) {
    adminState.invitesError = err?.message ?? 'Unable to load invites.';
  } finally {
    adminState.invitesLoading = false;
    adminState.invitesLoaded = true;
    renderAdminInvitesList();
  }
}

async function refreshAdminUsers() {
  const adminState = getAdminState();
  if (adminState.usersLoading) return;
  const orgId = state.workspace?.org_id ?? getAuthState().user?.org_id ?? null;
  const workspaceId = state.workspace?.id ?? null;
  if (!orgId && !workspaceId) {
    adminState.users = [];
    adminState.usersError = 'Select a workspace to manage users.';
    adminState.usersLoading = false;
    adminState.usersLoaded = true;
    renderAdminUsersList();
    renderAdminUserEditor();
    return;
  }
  adminState.usersRequestedAt = Date.now();
  adminState.usersLoading = true;
  adminState.usersError = '';
  renderAdminUsersList();
  try {
    const response = await api.listAdminUsers({ orgId, workspaceId, includeArchived: true });
    const users = Array.isArray(response?.users) ? response.users : [];
    adminState.users = users.map((user) => ({
      ...user,
      org_role: normalizeOrgRole(user.org_role),
      archived: Number(user.archived) ? 1 : 0,
      settings: user.settings && typeof user.settings === 'object' ? user.settings : {}
    }));
    syncAdminOwnerEmail(response?.owner_email ?? adminState.ownerEmail);
    if (!adminState.selectedUserId || !adminState.users.some((user) => user.id === adminState.selectedUserId)) {
      adminState.selectedUserId = adminState.users[0]?.id ?? '';
    }
    setAdminUsersStatus('');
  } catch (err) {
    adminState.usersError = err?.message ?? 'Unable to load users.';
  } finally {
    adminState.usersLoading = false;
    adminState.usersLoaded = true;
    renderAdminUsersList();
    renderAdminUserEditor();
    renderAccountMenu();
  }
}

function stopAdminInvitesAutoRefresh() {
  if (adminInvitesAutoRefreshTimer) {
    clearInterval(adminInvitesAutoRefreshTimer);
    adminInvitesAutoRefreshTimer = null;
  }
}

function startAdminInvitesAutoRefresh() {
  stopAdminInvitesAutoRefresh();
  adminInvitesAutoRefreshTimer = setInterval(() => {
    if (getActiveView() !== 'admin') return;
    void refreshAdminInvites();
  }, ADMIN_INVITES_AUTO_REFRESH_MS);
}

function stopAdminUsersAutoRefresh() {
  if (adminUsersAutoRefreshTimer) {
    clearInterval(adminUsersAutoRefreshTimer);
    adminUsersAutoRefreshTimer = null;
  }
}

function startAdminUsersAutoRefresh() {
  stopAdminUsersAutoRefresh();
  adminUsersAutoRefreshTimer = setInterval(() => {
    if (getActiveView() !== 'admin') return;
    void refreshAdminUsers();
  }, ADMIN_USERS_AUTO_REFRESH_MS);
}

async function deletePendingInvite(invite) {
  const inviteId = String(invite?.id ?? '').trim();
  if (!inviteId) {
    setAdminInviteStatus('Invite is missing a valid id.', 'error');
    showToast({ type: 'error', message: 'Invite could not be deleted because its id is invalid.' });
    return;
  }
  const inviteEmail = String(invite?.email ?? 'this invite').trim() || 'this invite';
  const confirmed = confirm(`Delete pending invite for ${inviteEmail}?`);
  if (!confirmed) return;
  try {
    await api.deleteAdminInvite(inviteId);
    setAdminInviteStatus(`Deleted pending invite for ${inviteEmail}.`);
    showToast({ type: 'success', message: `Deleted invite for ${inviteEmail}.` });
    await refreshAdminInvites();
  } catch (err) {
    const message = err?.message ?? 'Unable to delete invite.';
    setAdminInviteStatus(message, 'error');
    showToast({ type: 'error', message });
  }
}

async function submitAdminInvite() {
  if (!adminInviteEmail) return;
  const email = normalizeActorEmail(adminInviteEmail.value);
  if (!email) {
    setAdminInviteStatus('Enter a valid email address.', 'error');
    adminInviteEmail.focus();
    return;
  }
  const workspaceId = state.workspace?.id || '';
  if (!workspaceId) {
    setAdminInviteStatus('Select an active workspace first.', 'error');
    return;
  }
  const role = adminInviteRole?.value || 'member';
  adminInviteSend?.setAttribute('disabled', 'true');
  try {
    const response = await api.createAdminInvite({
      workspace_id: workspaceId,
      email,
      role
    });
    const inviteToken = String(response?.invite?.invite_token ?? '').trim();
    if (inviteToken) {
      setAdminInviteToken(inviteToken);
      setAdminInviteStatus(`Invite token generated for ${response?.invite?.email ?? email}.`);
      await copyInviteLinkToClipboard(inviteToken);
    } else {
      setAdminInviteToken('');
      setAdminInviteStatus('Invite created, but token is hidden by server configuration.', 'error');
    }
    adminInviteEmail.value = '';
    await refreshAdminInvites();
    await refreshAdminUsers();
  } catch (err) {
    setAdminInviteToken('');
    setAdminInviteStatus(err?.message ?? 'Unable to send invite.', 'error');
  } finally {
    adminInviteSend?.removeAttribute('disabled');
  }
}

async function submitAdminUserUpdate() {
  const selected = getSelectedAdminUser();
  if (!selected) {
    setAdminUsersStatus('Select a user first.', 'error');
    return;
  }
  const displayName = normalizeTitleInput(adminUserName?.value ?? selected.display_name);
  const email = normalizeActorEmail(adminUserEmail?.value ?? selected.email);
  if (!displayName) {
    setAdminUsersStatus('Display name is required.', 'error');
    adminUserName?.focus();
    return;
  }
  if (!email) {
    setAdminUsersStatus('Valid email is required.', 'error');
    adminUserEmail?.focus();
    return;
  }
  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(adminUserSettings?.value || '{}');
    if (!parsedSettings || typeof parsedSettings !== 'object' || Array.isArray(parsedSettings)) {
      throw new Error('Settings must be a JSON object.');
    }
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Invalid settings JSON.', 'error');
    adminUserSettings?.focus();
    return;
  }
  const patch = {
    display_name: displayName,
    email,
    settings: parsedSettings
  };
  if (adminUserArchived && !adminUserArchived.disabled) {
    patch.archived = adminUserArchived.value === '1' ? 1 : 0;
  }
  if (adminUserRole && !adminUserRole.disabled) {
    patch.org_role = adminUserRole.value || 'member';
  }
  try {
    const response = await api.updateAdminUser(selected.id, patch);
    const updatedUser = response?.user ?? null;
    if (updatedUser) {
      const adminState = getAdminState();
      adminState.users = adminState.users.map((user) =>
        user.id === updatedUser.id
          ? {
            ...user,
            ...updatedUser,
            org_role: normalizeOrgRole(updatedUser.org_role),
            archived: Number(updatedUser.archived) ? 1 : 0,
            settings: updatedUser.settings && typeof updatedUser.settings === 'object' ? updatedUser.settings : {}
          }
          : user
      );
      syncAdminOwnerEmail(response?.owner_email ?? adminState.ownerEmail);
      if (getAuthState().user?.id === updatedUser.id) {
        getAuthState().user = {
          ...getAuthState().user,
          display_name: updatedUser.display_name,
          email: updatedUser.email,
          org_role: normalizeOrgRole(updatedUser.org_role)
        };
        state.ui.profile = {
          name: updatedUser.display_name,
          email: updatedUser.email
        };
        applyUserSettingsPayload(updatedUser.settings ?? {});
      }
      upsertUser(updatedUser);
      render();
    }
    setAdminUsersStatus('User updated.');
    showToast({ type: 'success', message: 'User updated.' });
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Unable to update user.', 'error');
    showToast({ type: 'error', message: err?.message ?? 'Unable to update user.' });
  }
}

async function submitAdminPasswordReset() {
  const selected = getSelectedAdminUser();
  if (!selected) {
    setAdminUsersStatus('Select a user first.', 'error');
    return;
  }
  const password = String(adminUserPassword?.value ?? '');
  if (!password) {
    setAdminUsersStatus('Enter a temporary password.', 'error');
    adminUserPassword?.focus();
    return;
  }
  try {
    await api.resetAdminUserPassword(selected.id, password);
    if (adminUserPassword) adminUserPassword.value = '';
    setAdminUsersStatus(`Password reset for ${selected.email}.`);
    showToast({ type: 'success', message: `Password reset for ${selected.email}.` });
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Unable to reset password.', 'error');
    showToast({ type: 'error', message: err?.message ?? 'Unable to reset password.' });
  }
}

async function exportAdminSelectedUser() {
  const selected = getSelectedAdminUser();
  if (!selected) {
    setAdminUsersStatus('Select a user first.', 'error');
    return;
  }
  try {
    const response = await api.exportAdminUser(selected.id);
    const safeName = sanitizeExportFilenamePart(selected.email || selected.display_name || selected.id);
    const fileName = `${safeName}-account-export-${new Date().toISOString().slice(0, 10)}.json`;
    downloadExportBlob(JSON.stringify(response?.data ?? response ?? {}, null, 2), 'application/json', fileName);
    setAdminUsersStatus(`Exported ${selected.email}.`);
    showToast({ type: 'success', message: `Exported ${selected.email}.` });
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Unable to export user.', 'error');
    showToast({ type: 'error', message: err?.message ?? 'Unable to export user.' });
  }
}

async function deleteAdminSelectedUser() {
  const selected = getSelectedAdminUser();
  if (!selected) {
    setAdminUsersStatus('Select a user first.', 'error');
    return;
  }
  const confirmed = confirm(`Delete user ${selected.email}? This cannot be undone.`);
  if (!confirmed) return;
  try {
    await api.deleteAdminUser(selected.id);
    const deletedCurrentUser = getAuthState().user?.id === selected.id;
    const adminState = getAdminState();
    adminState.users = adminState.users.filter((user) => user.id !== selected.id);
    if (adminState.selectedUserId === selected.id) {
      adminState.selectedUserId = adminState.users[0]?.id ?? '';
    }
    setAdminUsersStatus(`Deleted ${selected.email}.`);
    showToast({ type: 'success', message: `Deleted ${selected.email}.` });
    renderAdminUsersList();
    renderAdminUserEditor();
    if (deletedCurrentUser) {
      await handleAccountAuthAction();
    }
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Unable to delete user.', 'error');
    showToast({ type: 'error', message: err?.message ?? 'Unable to delete user.' });
  }
}

async function transferOwnershipToSelectedUser() {
  if (!isCurrentActorOwnerSuperAdmin()) {
    setAdminUsersStatus('Only the current owner can transfer ownership.', 'error');
    return;
  }
  const selected = getSelectedAdminUser();
  if (!selected) {
    setAdminUsersStatus('Select a user first.', 'error');
    return;
  }
  const confirmed = confirm(`Transfer ownership to ${selected.email}?`);
  if (!confirmed) return;
  try {
    const response = await api.transferOwnership({
      target_user_id: selected.id
    });
    syncAdminOwnerEmail(response?.owner_email ?? selected.email);
    await refreshAdminUsers();
    setAdminUsersStatus(`Ownership transferred to ${selected.email}.`);
    showToast({ type: 'success', message: `Ownership transferred to ${selected.email}.` });
  } catch (err) {
    setAdminUsersStatus(err?.message ?? 'Unable to transfer ownership.', 'error');
    showToast({ type: 'error', message: err?.message ?? 'Unable to transfer ownership.' });
  }
}

function renderTaskViewToggle() {
  const view = getTaskView();
  if (taskViewSelect) {
    taskViewSelect.value = view;
  }
  if (taskColumnsButton) {
    taskColumnsButton.classList.toggle('hidden', view !== 'kanban');
  }
}

function renderTaskSidebarList() {
  if (!taskListListEl) return;
  if (!state.workspace) {
    taskListListEl.innerHTML = '';
    if (newTaskListBtn) newTaskListBtn.disabled = true;
    return;
  }
  if (newTaskListBtn) newTaskListBtn.disabled = false;
  const lists = getTaskSidebarLists();
  const activeFilter = getActiveTaskFilter();
  const activeContainer = getTaskContainerById(activeFilter);
  if (
    activeFilter
    && activeFilter !== TASK_FILTER_UNASSIGNED
    && activeFilter !== TASK_FILTER_INBOX
    && activeContainer?.kind === PROJECT_KIND_LIST
    && !lists.some((list) => list.id === activeFilter)
  ) {
    setActiveTaskFilter('all');
  }
  const currentActiveListId = getActiveTaskFilter();
  taskListListEl.innerHTML = '';
  if (!lists.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No extra lists yet.';
    taskListListEl.appendChild(empty);
    return;
  }
  lists.forEach((list) => {
    const row = document.createElement('div');
    row.className = 'workspace-row project-row' + (list.id === currentActiveListId ? ' active' : '');
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = list.name;
    selectBtn.addEventListener('click', () => {
      setActiveTaskFilter(list.id);
      setTaskGroupMode('section');
      clearActiveWorkflowChecklistInstanceId();
      setActiveView('tasks');
      render();
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button menu-icon';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'workspace-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextName = prompt('List name', list.name);
      if (!nextName) return;
      await updateProjectRecord(list.id, { name: normalizeTitleInput(nextName) || list.name });
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = 'Archive';
    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      await updateProjectRecord(list.id, { archived: 1 });
      if (getActiveTaskFilter() === list.id) {
        setActiveTaskFilter('all');
      }
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete list \"${list.name}\"? Tasks will become unassigned.`);
      if (!confirmed) return;
      await deleteProjectRecord(list.id);
      if (getActiveTaskFilter() === list.id) {
        setActiveTaskFilter('all');
      }
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    menu.appendChild(renameItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const badge = document.createElement('span');
    badge.className = 'project-badge';
    badge.textContent = 'List';

    row.appendChild(selectBtn);
    row.appendChild(badge);
    row.appendChild(menuWrapper);
    taskListListEl.appendChild(row);
  });
}

function renderProjectList() {
  if (!projectListEl) return;
  if (!state.workspace) {
    projectListEl.innerHTML = '';
    return;
  }
  projectListEl.innerHTML = '';
  const active = getProjectIdFromTaskFilter();
  if (active) {
    const exists = (state.projects ?? []).some(project => project.id === active && project.workspace_id === state.workspace.id && !project.archived);
    if (!exists) {
      state.ui.activeProjectId = null;
    }
  }

  getProjectsForWorkspace().forEach(project => {
    const row = document.createElement('div');
    row.className = 'workspace-row project-row' + (project.id === active ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = project.name;
    selectBtn.addEventListener('click', () => {
      setActiveTaskFilter(project.id);
      clearActiveWorkflowChecklistInstanceId();
      setActiveView('tasks');
      render();
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button menu-icon';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'workspace-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextName = prompt('Project name', project.name);
      if (!nextName) return;
      const updatedName = nextName.trim() || project.name;
      await updateProjectRecord(project.id, { name: updatedName });
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = 'Archive';
    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      await updateProjectRecord(project.id, { archived: 1 });
      if (state.ui?.activeProjectId === project.id) {
        state.ui.activeProjectId = null;
      }
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete project \"${project.name}\"? Tasks will become unassigned.`);
      if (!confirmed) return;
      await deleteProjectRecord(project.id);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    menu.appendChild(renameItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    const badge = document.createElement('span');
    badge.className = 'project-badge';
    badge.textContent = 'Project';

    row.appendChild(selectBtn);
    row.appendChild(badge);
    row.appendChild(menuWrapper);
    projectListEl.appendChild(row);
  });
}

function renderProjectsPage() {
  if (!projectsMobileList) return;
  projectsMobileList.innerHTML = '';
  if (!state.workspace) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'Select a workspace first.';
    projectsMobileList.appendChild(empty);
    return;
  }
  const filterKey = getProjectFilterKey();
  let projects = getProjectsForWorkspace({ includeArchived: filterKey !== 'open' });
  if (filterKey === 'open') {
    projects = projects.filter(project => !project.archived);
  } else if (filterKey === 'closed') {
    projects = projects.filter(project => Boolean(project.archived));
  }
  projects.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    if (filterKey === 'closed') {
      empty.textContent = 'No closed projects yet.';
    } else if (filterKey === 'all') {
      empty.textContent = 'No projects yet.';
    } else {
      empty.textContent = 'No open projects yet.';
    }
    projectsMobileList.appendChild(empty);
    return;
  }
  const active = getProjectIdFromTaskFilter();
  projects.forEach(project => {
    const row = document.createElement('div');
    row.className = 'workspace-row project-row' + (project.id === active ? ' active' : '');
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = project.name;
    if (project.archived) {
      selectBtn.disabled = true;
      selectBtn.title = 'Closed project';
    } else {
      selectBtn.addEventListener('click', () => {
        setActiveTaskFilter(project.id);
        clearActiveWorkflowChecklistInstanceId();
        setActiveView('tasks');
        render();
      });
    }
    const badge = document.createElement('span');
    badge.className = 'project-badge';
    badge.textContent = project.archived ? 'Closed' : 'Project';
    row.appendChild(selectBtn);
    row.appendChild(badge);
    projectsMobileList.appendChild(row);
  });
}

function populateProjectSelect(selectEl, selectedId = null, includeNone = true) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  if (includeNone) {
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    selectEl.appendChild(noneOption);
  }
  const containers = getTaskContainersForWorkspace()
    .slice()
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  containers.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    const kindLabel = project.kind === PROJECT_KIND_LIST ? 'List' : 'Project';
    option.textContent = `${project.name} (${kindLabel})`;
    selectEl.appendChild(option);
  });
  selectEl.value = selectedId ?? '';
}

function populateParentSelect(selectEl, taskId = null, selectedParentId = null) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  selectEl.appendChild(noneOption);
  if (!state.workspace) {
    selectEl.value = '';
    return;
  }
  const disallowed = new Set();
  const currentTask = taskId ? (state.tasks?.[taskId] ?? null) : null;
  const scopeProjectId = normalizeSectionScopeProjectId(currentTask?.project_id);
  if (taskId) {
    disallowed.add(taskId);
    getDescendants(taskId).forEach(task => disallowed.add(task.id));
  }
  const candidates = Object.values(state.tasks ?? {})
    .filter(task =>
      task.workspace_id === state.workspace.id
      && !disallowed.has(task.id)
      && normalizeSectionScopeProjectId(task.project_id) === scopeProjectId
    )
    .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  candidates.forEach(task => {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = task.title;
    selectEl.appendChild(option);
  });
  if (selectedParentId && !candidates.some(task => task.id === selectedParentId)) {
    const option = document.createElement('option');
    option.value = selectedParentId;
    option.textContent = 'Unknown task';
    selectEl.appendChild(option);
  }
  selectEl.value = selectedParentId ?? '';
}

function populateStatusSelect(selectEl, selectedKey = null) {
  if (!selectEl) return;
  const statuses = getStatusDefinitions();
  selectEl.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  selectEl.appendChild(noneOption);
  statuses.forEach(status => {
    const option = document.createElement('option');
    option.value = status.key;
    option.textContent = status.label;
    selectEl.appendChild(option);
  });
  const selected = normalizeTaskStatusValue(selectedKey);
  if (selected && statuses.some(status => status.key === selected)) {
    selectEl.value = selected;
  } else {
    selectEl.value = '';
  }
}

function populateTaskTypeSelect(selectEl, selectedName = null) {
  if (!selectEl) return;
  const types = getTaskTypesForWorkspace();
  selectEl.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  selectEl.appendChild(noneOption);
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type.name;
    option.textContent = type.name;
    selectEl.appendChild(option);
  });
  const normalized = selectedName ?? '';
  if (normalized && !types.some(type => type.name === normalized)) {
    const option = document.createElement('option');
    option.value = normalized;
    option.textContent = `${normalized} (legacy)`;
    selectEl.appendChild(option);
  }
  const fallback = normalized || getDefaultTaskTypeName();
  if (fallback && Array.from(selectEl.options).some(option => option.value === fallback)) {
    selectEl.value = fallback;
  } else {
    selectEl.value = '';
  }
}

function renderTemplateList() {
  if (!templateListEl) return;
  if (!state.workspace) {
    templateListEl.innerHTML = '';
    return;
  }
  templateListEl.innerHTML = '';
  const templates = state.templates ?? [];
  templates
    .filter(t => t.workspace_id === state.workspace.id && !t.archived)
    .forEach(template => {
    const row = document.createElement('div');
    row.className = 'workspace-row';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = template.next_event_date
      ? `${template.name} · next ${template.next_event_date}`
      : template.name;
    selectBtn.addEventListener('click', () => {
      openTemplateModal(template);
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button menu-icon';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const planItem = document.createElement('button');
    planItem.type = 'button';
    planItem.className = 'workspace-menu-item';
    planItem.textContent = 'Start plan';
    planItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      await startTemplatePlan(template);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
    });

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = 'Archive';
    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const updated = await api.updateTemplate(template.id, { archived: 1 });
      if (updated) upsertTemplate(updated);
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete template \"${template.name}\"?`);
      if (!confirmed) return;
      await api.deleteTemplate(template.id);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
    });

    menu.appendChild(planItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    row.appendChild(selectBtn);
    row.appendChild(menuWrapper);
    templateListEl.appendChild(row);
  });
}

function renderTeamMemberList() {
  if (!teamMemberListEl) return;
  if (!state.workspace) {
    teamMemberListEl.innerHTML = '';
    return;
  }
  teamMemberListEl.innerHTML = '';
  const users = getUsersForCurrentWorkspace();
  if (!users.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No members yet.';
    teamMemberListEl.appendChild(empty);
    return;
  }
  users.forEach((user) => {
    const membership = (state.workspaceMemberships ?? [])
      .find(item => item.workspace_id === state.workspace.id && item.user_id === user.id && !item.archived);
    if (!membership) return;
    const row = document.createElement('div');
    row.className = 'workspace-row';

    const summary = document.createElement('div');
    summary.className = 'workspace-select';
    const emailText = user.email ? ` · ${user.email}` : '';
    summary.textContent = `${user.display_name}${emailText}`;

    const roleSelect = document.createElement('select');
    roleSelect.className = 'setting-input';
    roleSelect.innerHTML = [
      '<option value="member">Member</option>',
      '<option value="manager">Manager</option>'
    ].join('');
    roleSelect.value = membership.role ?? 'member';
    roleSelect.addEventListener('change', async () => {
      await updateWorkspaceMembershipRecord(membership.id, { role: roleSelect.value });
      render();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-button';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove member';
    removeBtn.addEventListener('click', async () => {
      const confirmed = confirm(`Remove ${user.display_name} from this workspace?`);
      if (!confirmed) return;
      await deleteWorkspaceMembershipRecord(membership.id);
      render();
    });

    row.appendChild(summary);
    row.appendChild(roleSelect);
    row.appendChild(removeBtn);
    teamMemberListEl.appendChild(row);
  });
}

function renderTaskTypeList() {
  if (!taskTypeListEl) return;
  if (!state.workspace) {
    taskTypeListEl.innerHTML = '';
    return;
  }
  taskTypeListEl.innerHTML = '';
  const types = getTaskTypesForWorkspace();
  if (!types.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No task types yet.';
    taskTypeListEl.appendChild(empty);
    return;
  }

  types.forEach(type => {
    const row = document.createElement('div');
    row.className = 'task-type-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = type.name;
    input.addEventListener('change', async () => {
      const nextName = input.value.trim();
      if (!nextName || nextName === type.name) {
        input.value = type.name;
        return;
      }
      try {
        const updated = await updateTaskTypeRecord(type.id, { name: nextName });
        if (!updated) {
          input.value = type.name;
          return;
        }
        Object.values(state.tasks).forEach(task => {
          if (task.type_label === type.name) {
            task.type_label = nextName;
          }
        });
        render();
      } catch (err) {
        input.value = type.name;
        alert(err.message || 'Unable to rename task type.');
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-button';
    deleteBtn.textContent = '✕';
    deleteBtn.title = type.is_default ? 'Default types cannot be deleted' : 'Delete type';
    deleteBtn.disabled = Boolean(type.is_default);
    deleteBtn.addEventListener('click', async () => {
      if (type.is_default) return;
      const confirmed = confirm(`Delete type \"${type.name}\"? Tasks will lose this type.`);
      if (!confirmed) return;
      const result = await deleteTaskTypeRecord(type.id);
      if (result?.deleted) {
        Object.values(state.tasks).forEach(task => {
          if (task.type_label === type.name) {
            task.type_label = null;
          }
        });
        render();
      }
    });

    row.appendChild(input);
    row.appendChild(deleteBtn);
    taskTypeListEl.appendChild(row);
  });
}

function renderScheduleEventTypeList() {
  if (!scheduleEventTypeListEl) return;
  if (!state.workspace) {
    scheduleEventTypeListEl.innerHTML = '';
    return;
  }
  scheduleEventTypeListEl.innerHTML = '';
  const types = getScheduleEventTypesForWorkspace();
  if (!types.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No event types yet.';
    scheduleEventTypeListEl.appendChild(empty);
    return;
  }

  const canDelete = types.length > 1;
  types.forEach((type) => {
    const row = document.createElement('div');
    row.className = 'schedule-event-type-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = type.name;
    nameInput.placeholder = 'Type name';
    nameInput.addEventListener('change', () => {
      const nextName = normalizeTitleInput(nameInput.value);
      if (!nextName || nextName === type.name) {
        nameInput.value = type.name;
        return;
      }
      const updated = updateScheduleEventTypeRecord(type.id, { name: nextName });
      if (updated?.duplicate) {
        nameInput.value = type.name;
        alert('An event type with that name already exists.');
        return;
      }
      if (!updated) {
        nameInput.value = type.name;
        return;
      }
      render();
    });

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = normalizeScheduleEventColor(type.default_color) ?? SCHEDULE_CALENDAR_COLOR_PALETTE[0];
    colorInput.title = 'Default color';
    colorInput.addEventListener('change', () => {
      const nextColor = normalizeScheduleEventColor(colorInput.value) ?? SCHEDULE_CALENDAR_COLOR_PALETTE[0];
      if (nextColor === normalizeScheduleEventColor(type.default_color)) return;
      const updated = updateScheduleEventTypeRecord(type.id, { default_color: nextColor });
      if (!updated) return;
      syncScheduleEventColorInputs();
      render();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-button';
    deleteBtn.textContent = '✕';
    deleteBtn.title = canDelete ? 'Delete event type' : 'At least one event type is required';
    deleteBtn.disabled = !canDelete;
    deleteBtn.addEventListener('click', () => {
      if (!canDelete) return;
      const confirmed = confirm(`Delete event type \"${type.name}\"? Existing events keep their descriptions.`);
      if (!confirmed) return;
      const result = deleteScheduleEventTypeRecord(type.id);
      if (result?.error === 'last-type') {
        alert('At least one event type is required.');
        return;
      }
      if (result?.deleted) {
        render();
      }
    });

    const templateInput = document.createElement('textarea');
    templateInput.rows = 3;
    templateInput.value = String(type.description_template ?? '');
    templateInput.placeholder = 'Default description template (optional)';
    templateInput.addEventListener('change', () => {
      const nextTemplate = String(templateInput.value ?? '');
      if (nextTemplate === String(type.description_template ?? '')) return;
      const updated = updateScheduleEventTypeRecord(type.id, { description_template: nextTemplate });
      if (!updated) {
        templateInput.value = String(type.description_template ?? '');
        return;
      }
      if (scheduleEventType?.value === type.id) {
        syncScheduleEventDescriptionTemplate({ preserveValue: true });
      }
      render();
    });

    row.appendChild(nameInput);
    row.appendChild(colorInput);
    row.appendChild(deleteBtn);
    row.appendChild(templateInput);
    scheduleEventTypeListEl.appendChild(row);
  });
}

function renderStoreRuleList() {
  if (!storeRuleListEl) return;
  if (!state.workspace) {
    storeRuleListEl.innerHTML = '';
    return;
  }
  storeRuleListEl.innerHTML = '';
  const rules = getStoreRulesForWorkspace();
  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No stores yet.';
    storeRuleListEl.appendChild(empty);
    return;
  }

  rules.forEach(rule => {
    const row = document.createElement('div');
    row.className = 'store-rule-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = rule.store_name;
    nameInput.addEventListener('change', async () => {
      const nextName = nameInput.value.trim();
      if (!nextName || nextName === rule.store_name) {
        nameInput.value = rule.store_name;
        return;
      }
      const updated = await updateStoreRuleRecord(rule.id, { store_name: nextName });
      if (!updated) {
        nameInput.value = rule.store_name;
        return;
      }
      render();
    });

    const keywordsInput = document.createElement('input');
    keywordsInput.type = 'text';
    keywordsInput.value = formatStoreKeywords(rule.keywords);
    keywordsInput.addEventListener('change', async () => {
      const keywords = parseStoreKeywords(keywordsInput.value);
      const updated = await updateStoreRuleRecord(rule.id, { keywords });
      if (!updated) {
        keywordsInput.value = formatStoreKeywords(rule.keywords);
        return;
      }
      render();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-button';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete store';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = confirm(`Delete store \"${rule.store_name}\"?`);
      if (!confirmed) return;
      const result = await deleteStoreRuleRecord(rule.id);
      if (result?.deleted) {
        render();
      }
    });

    row.appendChild(nameInput);
    row.appendChild(keywordsInput);
    row.appendChild(deleteBtn);
    storeRuleListEl.appendChild(row);
  });
}

function renderNoticeSidebarList() {
  if (!noticeListEl) return;
  if (!state.workspace) {
    noticeListEl.innerHTML = '';
    return;
  }
  noticeListEl.innerHTML = '';
  const notices = (state.notices ?? [])
    .filter(notice => notice.workspace_id === state.workspace.id && !notice.dismissed_at)
    .sort((a, b) => new Date(a.notify_at).getTime() - new Date(b.notify_at).getTime());
  if (!notices.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No notices yet.';
    noticeListEl.appendChild(empty);
    return;
  }
  notices.forEach(notice => {
    const row = document.createElement('div');
    row.className = 'workspace-row notice-row';
    const info = document.createElement('div');
    info.className = 'notice-row-info';
    info.addEventListener('click', () => openNoticeModalWithNotice(notice));
    const title = document.createElement('div');
    title.className = 'notice-row-title';
    title.textContent = notice.title;
    const meta = document.createElement('div');
    meta.className = 'notice-row-meta';
    const date = new Date(notice.notify_at);
    const dateText = Number.isNaN(date.getTime())
      ? notice.notify_at
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const recurrenceLabel = formatNoticeRecurrence(getNoticeRecurrenceRule(notice));
    const recurrenceText = recurrenceLabel ? ` · repeats ${recurrenceLabel}` : '';
    meta.textContent = `${getNoticeTypeLabel(notice.notice_type)} · ${dateText}${recurrenceText}`;
    info.appendChild(title);
    info.appendChild(meta);

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button menu-icon';
    menuButton.textContent = '⋯';
    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const editItem = document.createElement('button');
    editItem.type = 'button';
    editItem.className = 'workspace-menu-item';
    editItem.textContent = 'Edit';
    editItem.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.classList.add('hidden');
      openMenu = null;
      openNoticeModalWithNotice(notice, { mode: 'edit' });
    });

    const dismissItem = document.createElement('button');
    dismissItem.type = 'button';
    dismissItem.className = 'workspace-menu-item';
    dismissItem.textContent = 'Dismiss';
    dismissItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      menu.classList.add('hidden');
      openMenu = null;
      await dismissNoticeWithUndo(notice);
    });

    menu.appendChild(editItem);
    menu.appendChild(dismissItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    row.appendChild(info);
    row.appendChild(menuWrapper);
    noticeListEl.appendChild(row);
  });
}

function renderWorkflowsPage() {
  if (!workflowDetailEl) return;
  workflowDetailEl.innerHTML = '';
  if (!state.workspace) {
    if (workflowPageTitle) workflowPageTitle.textContent = 'Workflows';
    if (workflowPageSubtitle) workflowPageSubtitle.textContent = 'Select a workflow to view runs.';
    workflowInstanceAddBtn?.classList.add('hidden');
    workflowMenuButton?.classList.add('hidden');
    workflowMenu?.classList.add('hidden');
    return;
  }

  const isMobileWorkflows = isMobileViewport();
  if (isMobileWorkflows && getWorkflowViewMode() !== 'runs') {
    setWorkflowViewMode('runs');
  }
  const viewMode = isMobileWorkflows ? 'runs' : getWorkflowViewMode();
  const isManageView = !isMobileWorkflows && viewMode === 'manage';
  const workflows = getWorkflowsForWorkspace();
  let mobilePanelMode = isMobileWorkflows ? getMobileWorkflowPanelMode() : 'instances';
  let workflow = getWorkflowById(getActiveWorkflowId());
  if (!workflow && workflows.length && !isMobileWorkflows) {
    setActiveWorkflowId(workflows[0].id);
    workflow = workflows[0];
  }
  if (isMobileWorkflows && mobilePanelMode === 'instances' && !workflow) {
    mobilePanelMode = 'list';
    setMobileWorkflowPanelMode('list');
  }
  const variants = workflow ? getWorkflowVariants(workflow.id) : [];

  if (workflowInstanceAddBtn) {
    workflowInstanceAddBtn.classList.toggle('hidden', !isManageView);
    if (isManageView) {
      workflowInstanceAddBtn.textContent = '✕';
      workflowInstanceAddBtn.title = 'Close manage workflows';
    } else {
      workflowInstanceAddBtn.textContent = '＋';
      workflowInstanceAddBtn.title = 'New workflow blueprint';
    }
  }
  workflowMenuButton?.classList.add('hidden');
  workflowMenu?.classList.add('hidden');
  if (workflowPageTitle) {
    workflowPageTitle.textContent = isManageView
      ? 'Manage Workflows'
      : (isMobileWorkflows && mobilePanelMode === 'list' ? 'Workflows' : (workflow?.name ?? 'Workflows'));
  }
  if (workflowPageSubtitle) {
    if (isManageView) {
      workflowPageSubtitle.textContent = 'Blueprints and builder.';
    } else if (isMobileWorkflows && mobilePanelMode === 'list') {
      workflowPageSubtitle.textContent = 'Choose a workflow to view open and completed instances.';
    } else {
      workflowPageSubtitle.textContent = workflow
        ? `Open and completed ${workflow.name.toLowerCase()}.`
        : 'Select a workflow to view runs.';
    }
  }

  if (isMobileWorkflows && mobilePanelMode === 'list') {
    const listSection = document.createElement('div');
    listSection.className = 'workflow-section workflow-mobile-list';
    if (!workflows.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-note';
      empty.textContent = 'No workflows yet.';
      listSection.appendChild(empty);
      workflowDetailEl.appendChild(listSection);
      return;
    }
    workflows.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'workflow-mobile-row';
      if (item.id === workflow?.id) {
        row.classList.add('is-active');
      }

      const info = document.createElement('div');
      info.className = 'workflow-mobile-row-main';
      const name = document.createElement('div');
      name.className = 'workflow-mobile-row-name';
      name.textContent = item.name;
      const allInstances = getWorkflowInstances(item.id);
      const summary = allInstances.reduce((acc, instance) => {
        const progress = getWorkflowInstanceProgress(instance.id);
        if (progress.isComplete) {
          acc.completed += 1;
        } else {
          acc.open += 1;
        }
        return acc;
      }, { open: 0, completed: 0 });
      const meta = document.createElement('div');
      meta.className = 'workflow-mobile-row-meta';
      meta.textContent = `${summary.open} open · ${summary.completed} completed`;
      info.appendChild(name);
      info.appendChild(meta);

      const chevron = document.createElement('span');
      chevron.className = 'workflow-mobile-row-chevron';
      chevron.textContent = '›';

      row.appendChild(info);
      row.appendChild(chevron);
      row.addEventListener('click', () => {
        setActiveWorkflowId(item.id);
        setWorkflowInstanceFilter('open');
        setMobileWorkflowPanelMode('instances');
        render();
      });
      listSection.appendChild(row);
    });
    workflowDetailEl.appendChild(listSection);
    return;
  }

  if (isManageView) {
    const manageLayout = document.createElement('div');
    manageLayout.className = 'workflow-manage-3pane';

    const blueprintPane = document.createElement('section');
    blueprintPane.className = 'workflow-section workflow-pane workflow-pane-blueprints';
    const blueprintHeader = document.createElement('div');
    blueprintHeader.className = 'workflow-section-header';
    const blueprintTitle = document.createElement('h3');
    blueprintTitle.textContent = 'Blueprints';
    const addBlueprintBtn = document.createElement('button');
    addBlueprintBtn.type = 'button';
    addBlueprintBtn.className = 'subtle-button';
    addBlueprintBtn.textContent = 'New blueprint';
    addBlueprintBtn.addEventListener('click', () => openWorkflowModal());
    blueprintHeader.appendChild(blueprintTitle);
    blueprintHeader.appendChild(addBlueprintBtn);
    blueprintPane.appendChild(blueprintHeader);

    const blueprintList = document.createElement('div');
    blueprintList.className = 'workflow-blueprint-list';
    if (!workflows.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-note';
      empty.textContent = 'No blueprints yet.';
      blueprintList.appendChild(empty);
    } else {
      workflows.forEach(item => {
        const row = document.createElement('div');
        row.className = `workflow-blueprint-row${item.id === workflow?.id ? ' active' : ''}`;

        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'workflow-blueprint-name';
        nameBtn.textContent = item.name;
        nameBtn.addEventListener('click', () => {
          setActiveWorkflowId(item.id);
          render();
        });
        row.appendChild(nameBtn);

        const menuWrapper = document.createElement('div');
        menuWrapper.className = 'workflow-blueprint-menu';
        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'icon-button menu-icon';
        menuButton.textContent = '⋯';
        menuButton.title = 'Blueprint actions';

        const menu = document.createElement('div');
        menu.className = 'workspace-menu hidden';
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'workspace-menu-item';
        renameBtn.textContent = 'Rename blueprint';
        renameBtn.addEventListener('click', () => {
          const nextName = prompt('Blueprint name', item.name);
          if (!nextName) return;
          const trimmed = nextName.trim();
          if (!trimmed || trimmed === item.name) return;
          updateWorkflowRecord(item.id, { name: trimmed });
          menu.classList.add('hidden');
          openMenu = null;
          render();
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'workspace-menu-item';
        deleteBtn.textContent = 'Delete blueprint';
        deleteBtn.addEventListener('click', () => {
          const confirmed = confirm(`Delete blueprint "${item.name}"? Workflows will remain.`);
          if (!confirmed) return;
          deleteWorkflowRecord(item.id);
          if (getActiveWorkflowId() === item.id) {
            setActiveWorkflowId(null);
            setActiveWorkflowVariantId(null);
          }
          menu.classList.add('hidden');
          openMenu = null;
          render();
        });
        menu.appendChild(renameBtn);
        menu.appendChild(deleteBtn);

        menuButton.addEventListener('click', (event) => {
          event.stopPropagation();
          if (openMenu && openMenu !== menu) openMenu.classList.add('hidden');
          if (menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
            openMenu = menu;
          } else {
            menu.classList.add('hidden');
            openMenu = null;
          }
        });
        menu.addEventListener('click', (event) => event.stopPropagation());

        menuWrapper.appendChild(menuButton);
        menuWrapper.appendChild(menu);
        row.appendChild(menuWrapper);
        blueprintList.appendChild(row);
      });
    }
    blueprintPane.appendChild(blueprintList);
    manageLayout.appendChild(blueprintPane);

    const builderPane = document.createElement('section');
    builderPane.className = 'workflow-section workflow-pane workflow-pane-builder';
    const builderHeader = document.createElement('div');
    builderHeader.className = 'workflow-section-header';
    const builderTitle = document.createElement('h3');
    builderTitle.textContent = 'Blueprint Builder';
    builderHeader.appendChild(builderTitle);
    builderPane.appendChild(builderHeader);

    const libraryPane = document.createElement('section');
    libraryPane.className = 'workflow-section workflow-pane workflow-pane-library';
    const libraryHeader = document.createElement('div');
    libraryHeader.className = 'workflow-section-header';
    const libraryTitle = document.createElement('h3');
    libraryTitle.textContent = 'Parts Library';
    libraryHeader.appendChild(libraryTitle);
    libraryPane.appendChild(libraryHeader);

    if (!workflow) {
      const builderNote = document.createElement('div');
      builderNote.className = 'sidebar-note';
      builderNote.textContent = 'Create a blueprint to start building.';
      builderPane.appendChild(builderNote);

      const libraryNote = document.createElement('div');
      libraryNote.className = 'sidebar-note';
      libraryNote.textContent = 'Patterns appear here after saving phases.';
      libraryPane.appendChild(libraryNote);

      manageLayout.appendChild(builderPane);
      manageLayout.appendChild(libraryPane);
      workflowDetailEl.appendChild(manageLayout);
      return;
    }

    const variantsByName = [...variants].sort((a, b) => a.name.localeCompare(b.name));
    let activeVariantId = getActiveWorkflowVariantId();
    if (activeVariantId && !variants.some(variant => variant.id === activeVariantId)) {
      activeVariantId = null;
    }
    if (!activeVariantId && variantsByName.length) {
      activeVariantId = variantsByName[0].id;
      setActiveWorkflowVariantId(activeVariantId);
    }

    const variantControls = document.createElement('div');
    variantControls.className = 'workflow-variant-controls';
    const variantSelect = document.createElement('select');
    variantSelect.className = 'workflow-variant-select';
    if (!variantsByName.length) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No types yet';
      variantSelect.appendChild(placeholder);
    } else {
      variantsByName.forEach(variant => {
        const option = document.createElement('option');
        option.value = variant.id;
        option.textContent = variant.name;
        variantSelect.appendChild(option);
      });
    }
    variantSelect.value = activeVariantId ?? '';
    variantSelect.addEventListener('change', () => {
      setActiveWorkflowVariantId(variantSelect.value || null);
      render();
    });
    variantControls.appendChild(variantSelect);

    if (activeVariantId) {
      const activeVariant = variants.find(item => item.id === activeVariantId) ?? null;
      if (activeVariant) {
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'workflow-variant-name-input';
        nameInput.value = activeVariant.name;
        nameInput.placeholder = 'Type name';
        const commitRename = () => {
          const trimmed = nameInput.value.trim();
          if (!trimmed) {
            nameInput.value = activeVariant.name;
            return;
          }
          if (trimmed === activeVariant.name) return;
          updateWorkflowVariantRecord(activeVariant.id, { name: trimmed });
          render();
        };
        nameInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitRename();
        });
        nameInput.addEventListener('blur', commitRename);
        variantControls.appendChild(nameInput);
      }

      const duplicateBtn = document.createElement('button');
      duplicateBtn.type = 'button';
      duplicateBtn.className = 'subtle-button';
      duplicateBtn.textContent = 'Duplicate type';
      duplicateBtn.addEventListener('click', () => {
        const nextVariant = duplicateWorkflowVariantRecord(activeVariantId);
        if (!nextVariant) return;
        setActiveWorkflowVariantId(nextVariant.id);
        render();
      });
      variantControls.appendChild(duplicateBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger-button';
      deleteBtn.textContent = 'Delete type';
      deleteBtn.addEventListener('click', () => {
        const variant = variants.find(item => item.id === activeVariantId);
        if (!variant) return;
        const confirmed = confirm(`Delete type "${variant.name}"? Existing workflows will lose their template reference.`);
        if (!confirmed) return;
        deleteWorkflowVariantRecord(variant.id);
        setActiveWorkflowVariantId(null);
        render();
      });
      variantControls.appendChild(deleteBtn);
    }
    builderPane.appendChild(variantControls);

    const addVariantRow = document.createElement('div');
    addVariantRow.className = 'workflow-add-row';
    const addVariantInput = document.createElement('input');
    addVariantInput.type = 'text';
    addVariantInput.placeholder = 'Add type...';
    addVariantInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const name = addVariantInput.value.trim();
      if (!name) return;
      const variant = createWorkflowVariantRecord(workflow.id, name);
      if (variant) {
        setActiveWorkflowVariantId(variant.id);
        addVariantInput.value = '';
        render();
      }
    });
    addVariantRow.appendChild(addVariantInput);
    builderPane.appendChild(addVariantRow);

    const patterns = getWorkflowPatternsForWorkspace();
    let variantPhases = [];
    if (!activeVariantId) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-note';
      empty.textContent = 'Add a type to define phases and tasks.';
      builderPane.appendChild(empty);
    } else {
      const phaseList = document.createElement('div');
      phaseList.className = 'workflow-phase-list';
      attachWorkflowPhaseDropzone(phaseList, activeVariantId);
      variantPhases = getWorkflowVariantPhases(activeVariantId);
      const taskOptions = [];
      variantPhases.forEach(entry => {
        const tasks = getWorkflowPhaseTasks(entry.phase.id);
        tasks.forEach(task => {
          if (task.item_kind === 'pattern') return;
          taskOptions.push({
            id: task.id,
            label: `${entry.phase.name} · ${task.title}`
          });
        });
      });

      variantPhases.forEach(entry => {
        const phase = entry.phase;
        const locked = Boolean(phase.locked);
        const collapsed = isWorkflowPhaseCollapsed(phase.id);
        const phaseCard = document.createElement('div');
        phaseCard.className = 'workflow-phase';
        phaseCard.dataset.phaseId = phase.id;

        const header = document.createElement('div');
        header.className = 'workflow-phase-header';
        const phaseDragHandle = document.createElement('span');
        phaseDragHandle.className = 'workflow-phase-drag-handle';
        phaseDragHandle.textContent = '⋮⋮';
        phaseDragHandle.title = locked ? 'Phase is locked' : 'Drag phase to reorder';
        header.appendChild(phaseDragHandle);
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'icon-button workflow-pattern-toggle';
        toggleBtn.textContent = collapsed ? '▸' : '▾';
        toggleBtn.title = collapsed ? 'Show phase tasks' : 'Hide phase tasks';
        toggleBtn.addEventListener('click', () => {
          setWorkflowPhaseCollapsed(phase.id, !collapsed);
          render();
        });
        header.appendChild(toggleBtn);
        if (collapsed) {
          const phaseName = document.createElement('strong');
          phaseName.className = 'workflow-pattern-name-label';
          phaseName.textContent = phase.name;
          header.appendChild(phaseName);
        } else {
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.value = phase.name;
          nameInput.disabled = locked;
          nameInput.addEventListener('change', () => {
            const trimmed = nameInput.value.trim();
            if (!trimmed || trimmed === phase.name) {
              nameInput.value = phase.name;
              return;
            }
            updateWorkflowPhaseRecord(phase.id, { name: trimmed });
            render();
          });
          header.appendChild(nameInput);
        }
        const savePatternBtn = document.createElement('button');
        savePatternBtn.type = 'button';
        savePatternBtn.className = 'subtle-button';
        savePatternBtn.textContent = 'Save pattern';
        savePatternBtn.title = 'Extract this phase as a reusable pattern';
        savePatternBtn.addEventListener('click', () => {
          createPatternFromPhase(workflow.id, phase.id, phase.name);
          render();
        });
        if (!collapsed) {
          header.appendChild(savePatternBtn);
          const lockBtn = document.createElement('button');
          lockBtn.type = 'button';
          lockBtn.className = 'icon-button workflow-pattern-lock';
          lockBtn.textContent = locked ? '🔒' : '🔓';
          lockBtn.title = locked ? 'Unlock phase' : 'Lock phase';
          lockBtn.addEventListener('click', () => {
            updateWorkflowPhaseRecord(phase.id, { locked: !locked });
            render();
          });
          header.appendChild(lockBtn);
        }
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-button';
        removeBtn.textContent = '✕';
        removeBtn.title = locked ? 'Unlock phase to remove it' : 'Remove phase';
        removeBtn.disabled = locked;
        removeBtn.addEventListener('click', () => {
          const confirmed = confirm(`Remove phase "${phase.name}" from this type?`);
          if (!confirmed) return;
          unlinkWorkflowVariantPhase(activeVariantId, phase.id);
          render();
        });
        header.appendChild(removeBtn);
        phaseCard.appendChild(header);
        if (collapsed) {
          if (!locked) {
            attachWorkflowPhaseDragHandlers(phaseCard, phaseDragHandle, activeVariantId, phase.id);
          }
          phaseList.appendChild(phaseCard);
          return;
        }

        const taskList = document.createElement('div');
        if (!locked) {
          attachWorkflowEntryDropzone(taskList, 'phase', phase.id);
        }
        const phaseTasks = getWorkflowPhaseTasks(phase.id);
        if (!phaseTasks.length) {
          const empty = document.createElement('div');
          empty.className = 'sidebar-note';
          empty.textContent = 'No entries yet.';
          taskList.appendChild(empty);
        }
        phaseTasks.forEach(task => {
          const row = document.createElement('div');
          row.className = 'workflow-task-row';
          row.dataset.entryId = task.id;
          const dragHandle = document.createElement('span');
          dragHandle.className = 'workflow-drag-handle';
          dragHandle.textContent = '⋮⋮';
          dragHandle.title = locked ? 'Phase is locked' : 'Drag to reorder';
          row.appendChild(dragHandle);
          if (task.item_kind === 'pattern') {
            row.classList.add('workflow-task-row-pattern');
            const kindBadge = document.createElement('span');
            kindBadge.className = 'workflow-pattern-badge';
            kindBadge.textContent = 'Pattern';
            const patternLabel = document.createElement('strong');
            patternLabel.textContent = task.title;
            row.appendChild(kindBadge);
            row.appendChild(patternLabel);
            const referencedPattern = task.pattern_id ? getWorkflowPatternById(task.pattern_id) : null;
            if (referencedPattern?.if_applicable) {
              const patternOptionalBadge = document.createElement('span');
              patternOptionalBadge.className = 'workflow-optional-badge';
              patternOptionalBadge.textContent = 'IA';
              patternOptionalBadge.title = 'If applicable';
              row.appendChild(patternOptionalBadge);
            }
          } else {
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = task.title;
            titleInput.disabled = locked;
            titleInput.addEventListener('change', () => {
              const trimmed = titleInput.value.trim();
              if (!trimmed || trimmed === task.title) {
                titleInput.value = task.title;
                return;
              }
              updateWorkflowPhaseTaskRecord(task.id, { title: trimmed });
              render();
            });
            row.appendChild(titleInput);

            const depSelect = document.createElement('select');
            depSelect.className = 'workflow-task-dep';
            depSelect.disabled = locked;
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Depends on...';
            depSelect.appendChild(placeholder);
            taskOptions.forEach(option => {
              if (option.id === task.id) return;
              const opt = document.createElement('option');
              opt.value = option.id;
              opt.textContent = option.label;
              depSelect.appendChild(opt);
            });
            depSelect.value = task.depends_on_ids?.[0] ?? '';
            depSelect.addEventListener('change', () => {
              const value = depSelect.value;
              updateWorkflowPhaseTaskRecord(task.id, { depends_on_ids: value ? [value] : [] });
              render();
            });
            row.appendChild(depSelect);

            const assigneeEditor = createWorkflowTemplateAssigneeEditor(task, {
              locked,
              onSave: (patch) => {
                updateWorkflowPhaseTaskRecord(task.id, patch);
                render();
              }
            });
            row.appendChild(assigneeEditor);

            const optionalLabel = document.createElement('label');
            optionalLabel.className = 'workflow-optional-toggle';
            optionalLabel.dataset.tooltip = 'If applicable';
            const optionalInput = document.createElement('input');
            optionalInput.type = 'checkbox';
            optionalInput.checked = Boolean(task.if_applicable);
            optionalInput.disabled = locked;
            optionalInput.addEventListener('change', () => {
              updateWorkflowPhaseTaskRecord(task.id, { if_applicable: optionalInput.checked });
            });
            const optionalText = document.createElement('span');
            optionalText.className = 'workflow-optional-badge';
            optionalText.textContent = 'IA';
            optionalLabel.appendChild(optionalInput);
            optionalLabel.appendChild(optionalText);
            row.appendChild(optionalLabel);
          }

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'icon-button';
          deleteBtn.textContent = '✕';
          deleteBtn.title = locked ? 'Phase is locked' : 'Delete task';
          deleteBtn.disabled = locked;
          deleteBtn.addEventListener('click', () => {
            const confirmed = confirm(`Delete task "${task.title}"?`);
            if (!confirmed) return;
            deleteWorkflowPhaseTaskRecord(task.id);
            render();
          });
          row.appendChild(deleteBtn);
          if (!locked) {
            attachWorkflowEntryDragHandlers(row, dragHandle, 'phase', phase.id, task.id);
          }
          taskList.appendChild(row);
        });

        const addTaskRow = document.createElement('div');
        addTaskRow.className = 'workflow-add-row';
        const addTaskInput = document.createElement('input');
        addTaskInput.type = 'text';
        addTaskInput.placeholder = locked ? 'Phase locked' : 'Add task...';
        addTaskInput.disabled = locked;
        addTaskInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const name = addTaskInput.value.trim();
          if (!name) return;
          createWorkflowPhaseTaskRecord(phase.id, name);
          addTaskInput.value = '';
          render();
        });
        addTaskRow.appendChild(addTaskInput);
        phaseCard.appendChild(taskList);
        phaseCard.appendChild(addTaskRow);

        if (patterns.length) {
          const addPatternRow = document.createElement('div');
          addPatternRow.className = 'workflow-copy-row';
          const patternSelect = document.createElement('select');
          patternSelect.className = 'workflow-copy-select';
          patternSelect.disabled = locked;
          patterns.forEach(pattern => {
            const option = document.createElement('option');
            option.value = pattern.id;
            option.textContent = pattern.name;
            patternSelect.appendChild(option);
          });
          const addPatternBtn = document.createElement('button');
          addPatternBtn.type = 'button';
          addPatternBtn.className = 'subtle-button';
          addPatternBtn.textContent = 'Add pattern';
          addPatternBtn.disabled = locked;
          addPatternBtn.addEventListener('click', () => {
            const patternId = patternSelect.value;
            if (!patternId) return;
            insertPatternIntoPhase({ phaseId: phase.id, patternId });
            render();
          });
          addPatternRow.appendChild(patternSelect);
          addPatternRow.appendChild(addPatternBtn);
          phaseCard.appendChild(addPatternRow);
        }
        if (!locked) {
          attachWorkflowPhaseDragHandlers(phaseCard, phaseDragHandle, activeVariantId, phase.id);
        }
        phaseList.appendChild(phaseCard);
      });

      const addPhaseRow = document.createElement('div');
      addPhaseRow.className = 'workflow-add-row';
      const addPhaseInput = document.createElement('input');
      addPhaseInput.type = 'text';
      addPhaseInput.placeholder = 'Add phase...';
      addPhaseInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const name = addPhaseInput.value.trim();
        if (!name) return;
        const phase = createWorkflowPhaseRecord(workflow.id, name);
        if (phase) {
          linkWorkflowVariantPhase(activeVariantId, phase.id);
          addPhaseInput.value = '';
          render();
        }
      });
      addPhaseRow.appendChild(addPhaseInput);
      phaseList.appendChild(addPhaseRow);
      builderPane.appendChild(phaseList);
    }

    const insertSection = document.createElement('div');
    insertSection.className = 'workflow-pane-block';
    const insertTitle = document.createElement('h4');
    insertTitle.textContent = 'Build from parts';
    insertSection.appendChild(insertTitle);
    if (!activeVariantId) {
      const note = document.createElement('div');
      note.className = 'sidebar-note';
      note.textContent = 'Select a type to insert patterns.';
      insertSection.appendChild(note);
    } else if (!variantPhases.length) {
      const note = document.createElement('div');
      note.className = 'sidebar-note';
      note.textContent = 'Add at least one phase to insert patterns.';
      insertSection.appendChild(note);
    } else if (!patterns.length) {
      const note = document.createElement('div');
      note.className = 'sidebar-note';
      note.textContent = 'No patterns yet. Save a phase as a pattern first.';
      insertSection.appendChild(note);
    } else {
      const row = document.createElement('div');
      row.className = 'workflow-copy-row';
      const phaseSelect = document.createElement('select');
      phaseSelect.className = 'workflow-copy-select';
      variantPhases.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.phase.id;
        option.textContent = entry.phase.name;
        phaseSelect.appendChild(option);
      });
      const patternSelect = document.createElement('select');
      patternSelect.className = 'workflow-copy-select';
      patterns.forEach(pattern => {
        const option = document.createElement('option');
        option.value = pattern.id;
        option.textContent = pattern.name;
        patternSelect.appendChild(option);
      });
      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'subtle-button';
      insertBtn.textContent = 'Insert pattern';
      insertBtn.addEventListener('click', () => {
        const phaseId = phaseSelect.value;
        const patternId = patternSelect.value;
        if (!phaseId || !patternId) return;
        insertPatternIntoPhase({ phaseId, patternId });
        render();
      });
      row.appendChild(phaseSelect);
      row.appendChild(patternSelect);
      row.appendChild(insertBtn);
      insertSection.appendChild(row);
    }
    libraryPane.appendChild(insertSection);

    const copySection = document.createElement('div');
    copySection.className = 'workflow-pane-block';
    const copyTitle = document.createElement('h4');
    copyTitle.textContent = 'Copy from blueprint';
    copySection.appendChild(copyTitle);
    if (!activeVariantId) {
      const note = document.createElement('div');
      note.className = 'sidebar-note';
      note.textContent = 'Select a type to copy phases into.';
      copySection.appendChild(note);
    } else {
      const sourceBlueprints = getWorkflowsForWorkspace().filter(item => item.id !== workflow.id);
      if (!sourceBlueprints.length) {
        const note = document.createElement('div');
        note.className = 'sidebar-note';
        note.textContent = 'No other blueprints available.';
        copySection.appendChild(note);
      } else {
        const row = document.createElement('div');
        row.className = 'workflow-copy-row';
        const sourceSelect = document.createElement('select');
        sourceSelect.className = 'workflow-copy-select';
        sourceBlueprints.forEach(item => {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          sourceSelect.appendChild(option);
        });
        const phaseSelect = document.createElement('select');
        phaseSelect.className = 'workflow-copy-select';
        const populatePhaseOptions = (sourceId) => {
          phaseSelect.innerHTML = '';
          const phases = getWorkflowPhases(sourceId);
          if (!phases.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No phases available';
            phaseSelect.appendChild(option);
            return;
          }
          phases.forEach(phase => {
            const option = document.createElement('option');
            option.value = phase.id;
            option.textContent = phase.name;
            phaseSelect.appendChild(option);
          });
        };
        populatePhaseOptions(sourceSelect.value);
        sourceSelect.addEventListener('change', () => populatePhaseOptions(sourceSelect.value));
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'subtle-button';
        copyBtn.textContent = 'Copy phase';
        copyBtn.addEventListener('click', () => {
          const sourceId = sourceSelect.value;
          const phaseId = phaseSelect.value;
          if (!sourceId || !phaseId) return;
          copyWorkflowPhaseToBlueprint({
            sourceWorkflowId: sourceId,
            phaseId,
            targetWorkflowId: workflow.id,
            targetVariantId: activeVariantId
          });
          render();
        });
        row.appendChild(sourceSelect);
        row.appendChild(phaseSelect);
        row.appendChild(copyBtn);
        copySection.appendChild(row);
      }
    }
    libraryPane.appendChild(copySection);

    const patternLibrarySection = document.createElement('div');
    patternLibrarySection.className = 'workflow-pane-block';
    const patternLibraryTitle = document.createElement('h4');
    patternLibraryTitle.textContent = 'Pattern library';
    patternLibrarySection.appendChild(patternLibraryTitle);

    const addPatternRow = document.createElement('div');
    addPatternRow.className = 'workflow-add-row';
    const addPatternInput = document.createElement('input');
    addPatternInput.type = 'text';
    addPatternInput.placeholder = 'Add pattern...';
    addPatternInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const raw = addPatternInput.value.trim();
      if (!raw) return;
      const name = makeUniquePatternName(normalizeTitleInput(raw));
      createWorkflowPatternRecord(name);
      addPatternInput.value = '';
      render();
    });
    addPatternRow.appendChild(addPatternInput);
    patternLibrarySection.appendChild(addPatternRow);

    if (!patterns.length) {
      const note = document.createElement('div');
      note.className = 'sidebar-note';
      note.textContent = 'No patterns yet.';
      patternLibrarySection.appendChild(note);
    } else {
      patterns.forEach(pattern => {
        const patternCard = document.createElement('div');
        patternCard.className = 'workflow-phase';
        const collapsed = isWorkflowPatternCollapsed(pattern.id);
        const locked = Boolean(pattern.locked);

        const patternHeader = document.createElement('div');
        patternHeader.className = 'workflow-phase-header';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'icon-button workflow-pattern-toggle';
        toggleBtn.textContent = collapsed ? '▸' : '▾';
        toggleBtn.title = collapsed ? 'Show pattern tasks' : 'Hide pattern tasks';
        toggleBtn.addEventListener('click', () => {
          setWorkflowPatternCollapsed(pattern.id, !collapsed);
          render();
        });
        patternHeader.appendChild(toggleBtn);

        if (collapsed) {
          const patternName = document.createElement('strong');
          patternName.className = 'workflow-pattern-name-label';
          patternName.textContent = pattern.name;
          patternHeader.appendChild(patternName);
        } else {
          const patternNameInput = document.createElement('input');
          patternNameInput.type = 'text';
          patternNameInput.value = pattern.name;
          patternNameInput.disabled = locked;
          const commitRename = () => {
            if (locked) return;
            const trimmed = patternNameInput.value.trim();
            if (!trimmed) {
              patternNameInput.value = pattern.name;
              return;
            }
            if (trimmed === pattern.name) return;
            updateWorkflowPatternRecord(pattern.id, { name: trimmed });
            render();
          };
          patternNameInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitRename();
          });
          patternNameInput.addEventListener('blur', commitRename);
          patternHeader.appendChild(patternNameInput);

          const lockBtn = document.createElement('button');
          lockBtn.type = 'button';
          lockBtn.className = 'icon-button workflow-pattern-lock';
          lockBtn.textContent = locked ? '🔒' : '🔓';
          lockBtn.title = locked ? 'Unlock pattern' : 'Lock pattern';
          lockBtn.addEventListener('click', () => {
            updateWorkflowPatternRecord(pattern.id, { locked: !locked });
            render();
          });
          patternHeader.appendChild(lockBtn);
        }

        const patternOptionalLabel = document.createElement('label');
        patternOptionalLabel.className = 'workflow-optional-toggle';
        patternOptionalLabel.dataset.tooltip = 'If applicable';
        const patternOptionalInput = document.createElement('input');
        patternOptionalInput.type = 'checkbox';
        patternOptionalInput.checked = Boolean(pattern.if_applicable);
        patternOptionalInput.disabled = locked;
        patternOptionalInput.addEventListener('change', () => {
          updateWorkflowPatternRecord(pattern.id, { if_applicable: patternOptionalInput.checked });
          render();
        });
        const patternOptionalText = document.createElement('span');
        patternOptionalText.className = 'workflow-optional-badge';
        patternOptionalText.textContent = 'IA';
        patternOptionalLabel.appendChild(patternOptionalInput);
        patternOptionalLabel.appendChild(patternOptionalText);
        patternHeader.appendChild(patternOptionalLabel);

        const deletePatternBtn = document.createElement('button');
        deletePatternBtn.type = 'button';
        deletePatternBtn.className = 'icon-button';
        deletePatternBtn.textContent = '✕';
        deletePatternBtn.title = locked ? 'Unlock pattern to delete it' : 'Delete pattern';
        deletePatternBtn.disabled = locked;
        deletePatternBtn.addEventListener('click', () => {
          const confirmed = confirm(`Delete pattern "${pattern.name}"?`);
          if (!confirmed) return;
          deleteWorkflowPatternRecord(pattern.id);
          render();
        });
        patternHeader.appendChild(deletePatternBtn);
        patternCard.appendChild(patternHeader);

        if (collapsed) {
          patternLibrarySection.appendChild(patternCard);
          return;
        }

        const patternTasks = getWorkflowPatternTasks(pattern.id);
        const patternTaskOptions = patternTasks.filter(task => task.item_kind !== 'pattern').map(task => ({
          id: task.id,
          label: task.title
        }));
        const patternTaskList = document.createElement('div');
        if (!locked) {
          attachWorkflowEntryDropzone(patternTaskList, 'pattern', pattern.id);
        }
        if (!patternTasks.length) {
          const empty = document.createElement('div');
          empty.className = 'sidebar-note';
          empty.textContent = 'No tasks yet.';
          patternTaskList.appendChild(empty);
        }
        patternTasks.forEach(task => {
          const row = document.createElement('div');
          row.className = 'workflow-task-row';
          row.dataset.entryId = task.id;
          const dragHandle = document.createElement('span');
          dragHandle.className = 'workflow-drag-handle';
          dragHandle.textContent = '⋮⋮';
          dragHandle.title = locked ? 'Pattern is locked' : 'Drag to reorder';
          row.appendChild(dragHandle);
          if (task.item_kind === 'pattern') {
            row.classList.add('workflow-task-row-pattern');
            const kindBadge = document.createElement('span');
            kindBadge.className = 'workflow-pattern-badge';
            kindBadge.textContent = 'Pattern';
            const label = document.createElement('strong');
            const referenced = task.referenced_pattern_id ? getWorkflowPatternById(task.referenced_pattern_id) : null;
            label.textContent = referenced?.name ?? task.title;
            row.appendChild(kindBadge);
            row.appendChild(label);
            if (referenced?.if_applicable) {
              const patternOptionalBadge = document.createElement('span');
              patternOptionalBadge.className = 'workflow-optional-badge';
              patternOptionalBadge.textContent = 'IA';
              patternOptionalBadge.title = 'If applicable';
              row.appendChild(patternOptionalBadge);
            }
          } else {
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = task.title;
            titleInput.disabled = locked;
            titleInput.addEventListener('change', () => {
              const trimmed = titleInput.value.trim();
              if (!trimmed || trimmed === task.title) {
                titleInput.value = task.title;
                return;
              }
              updateWorkflowPatternTaskRecord(task.id, { title: trimmed });
              render();
            });
            row.appendChild(titleInput);

            const depSelect = document.createElement('select');
            depSelect.className = 'workflow-task-dep';
            depSelect.disabled = locked;
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Depends on...';
            depSelect.appendChild(placeholder);
            patternTaskOptions.forEach(option => {
              if (option.id === task.id) return;
              const opt = document.createElement('option');
              opt.value = option.id;
              opt.textContent = option.label;
              depSelect.appendChild(opt);
            });
            depSelect.value = task.depends_on_ids?.[0] ?? '';
            depSelect.addEventListener('change', () => {
              const value = depSelect.value;
              updateWorkflowPatternTaskRecord(task.id, { depends_on_ids: value ? [value] : [] });
              render();
            });
            row.appendChild(depSelect);

            const assigneeEditor = createWorkflowTemplateAssigneeEditor(task, {
              locked,
              onSave: (patch) => {
                updateWorkflowPatternTaskRecord(task.id, patch);
                render();
              }
            });
            row.appendChild(assigneeEditor);

            const optionalLabel = document.createElement('label');
            optionalLabel.className = 'workflow-optional-toggle';
            optionalLabel.dataset.tooltip = 'If applicable';
            const optionalInput = document.createElement('input');
            optionalInput.type = 'checkbox';
            optionalInput.checked = Boolean(task.if_applicable);
            optionalInput.disabled = locked;
            optionalInput.addEventListener('change', () => {
              updateWorkflowPatternTaskRecord(task.id, { if_applicable: optionalInput.checked });
            });
            const optionalText = document.createElement('span');
            optionalText.className = 'workflow-optional-badge';
            optionalText.textContent = 'IA';
            optionalLabel.appendChild(optionalInput);
            optionalLabel.appendChild(optionalText);
            row.appendChild(optionalLabel);
          }

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'icon-button';
          deleteBtn.textContent = '✕';
          deleteBtn.title = locked ? 'Pattern is locked' : 'Delete task';
          deleteBtn.disabled = locked;
          deleteBtn.addEventListener('click', () => {
            deleteWorkflowPatternTaskRecord(task.id);
            render();
          });
          row.appendChild(deleteBtn);
          if (!locked) {
            attachWorkflowEntryDragHandlers(row, dragHandle, 'pattern', pattern.id, task.id);
          }
          patternTaskList.appendChild(row);
        });

        const addTaskRow = document.createElement('div');
        addTaskRow.className = 'workflow-add-row';
        const addTaskInput = document.createElement('input');
        addTaskInput.type = 'text';
        addTaskInput.placeholder = locked ? 'Pattern locked' : 'Add task...';
        addTaskInput.disabled = locked;
        addTaskInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const name = addTaskInput.value.trim();
          if (!name) return;
          createWorkflowPatternTaskRecord(pattern.id, name);
          addTaskInput.value = '';
          render();
        });
        addTaskRow.appendChild(addTaskInput);
        patternCard.appendChild(patternTaskList);
        patternCard.appendChild(addTaskRow);

        const candidatePatterns = patterns.filter(candidate => candidate.id !== pattern.id);
        if (candidatePatterns.length) {
          const addPatternRow = document.createElement('div');
          addPatternRow.className = 'workflow-copy-row';
          const nestedPatternSelect = document.createElement('select');
          nestedPatternSelect.className = 'workflow-copy-select';
          nestedPatternSelect.disabled = locked;
          candidatePatterns.forEach(candidate => {
            const option = document.createElement('option');
            option.value = candidate.id;
            option.textContent = candidate.name;
            nestedPatternSelect.appendChild(option);
          });
          const addNestedPatternBtn = document.createElement('button');
          addNestedPatternBtn.type = 'button';
          addNestedPatternBtn.className = 'subtle-button';
          addNestedPatternBtn.textContent = 'Add pattern';
          addNestedPatternBtn.disabled = locked;
          addNestedPatternBtn.addEventListener('click', () => {
            const childPatternId = nestedPatternSelect.value;
            if (!childPatternId) return;
            const inserted = insertPatternIntoPattern({
              targetPatternId: pattern.id,
              childPatternId
            });
            if (!inserted) {
              alert('Pattern cycle detected. Choose a different pattern.');
              return;
            }
            render();
          });
          addPatternRow.appendChild(nestedPatternSelect);
          addPatternRow.appendChild(addNestedPatternBtn);
          patternCard.appendChild(addPatternRow);
        }
        patternLibrarySection.appendChild(patternCard);
      });
    }

    libraryPane.appendChild(patternLibrarySection);
    manageLayout.appendChild(builderPane);
    manageLayout.appendChild(libraryPane);
    workflowDetailEl.appendChild(manageLayout);
    return;
  }

  if (!workflow) {
    // Subtitle already communicates this empty state; avoid duplicate copy in the detail pane.
    return;
  }

  const instanceSection = document.createElement('div');
  instanceSection.className = 'workflow-section';
  const instanceHeader = document.createElement('div');
  instanceHeader.className = 'workflow-section-header';
  if (isMobileWorkflows) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'subtle-button';
    backBtn.textContent = '← Workflows';
    backBtn.addEventListener('click', () => {
      setMobileWorkflowPanelMode('list');
      render();
    });
    instanceHeader.appendChild(backBtn);
  }
  const instanceNoun = getWorkflowInstanceNoun(workflow.name);
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'subtle-button';
  runBtn.textContent = `New ${instanceNoun}`;
  runBtn.disabled = !isWorkflowUsable(workflow.id);
  runBtn.title = runBtn.disabled
    ? 'Add a type with tasks before creating new items.'
    : `Start a new ${instanceNoun.toLowerCase()}`;
  runBtn.addEventListener('click', () => {
    openWorkflowInstanceModal();
  });
  const filterGroup = document.createElement('div');
  filterGroup.className = 'workflow-instance-filters';
  const filterSelect = document.createElement('select');
  filterSelect.className = 'workflow-instance-filter-select';
  const openOption = document.createElement('option');
  openOption.value = 'open';
  openOption.textContent = 'Open';
  const completedOption = document.createElement('option');
  completedOption.value = 'completed';
  completedOption.textContent = 'Completed';
  filterSelect.appendChild(openOption);
  filterSelect.appendChild(completedOption);
  filterSelect.value = getWorkflowInstanceFilter() === 'completed' ? 'completed' : 'open';
  filterSelect.addEventListener('change', () => {
    setWorkflowInstanceFilter(filterSelect.value === 'completed' ? 'completed' : 'open');
    render();
  });
  filterGroup.appendChild(filterSelect);
  instanceHeader.appendChild(filterGroup);
  instanceHeader.appendChild(runBtn);
  instanceSection.appendChild(instanceHeader);
  const instances = getWorkflowInstances(workflow.id);
  const filter = getWorkflowInstanceFilter();
  const visibleInstances = instances.filter(instance => {
    const progress = getWorkflowInstanceProgress(instance.id);
    return filter === 'completed' ? progress.isComplete : !progress.isComplete;
  });
  if (!visibleInstances.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    const pluralLabel = workflow.name.toLowerCase();
    empty.textContent = filter === 'completed'
      ? `No completed ${pluralLabel} yet.`
      : `No open ${pluralLabel} yet.`;
    instanceSection.appendChild(empty);
  } else {
    visibleInstances.forEach(instance => {
      const row = document.createElement('div');
      row.className = 'workflow-instance-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open checklist for ${instance.title}`);
      row.addEventListener('click', () => {
        openWorkflowInstanceChecklist(instance.id);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openWorkflowInstanceChecklist(instance.id);
      });
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = instance.title;
      const variant = variants.find(item => item.id === instance.variant_id);
      const links = getWorkflowInstanceTasks(instance.id);
      const progress = getWorkflowInstanceProgress(instance.id);
      const meta = document.createElement('div');
      meta.className = 'workflow-instance-meta';
      const statusLabel = progress.isComplete ? 'Complete' : 'Open';
      const resolvedText = progress.total ? `${progress.resolved}/${progress.total} resolved` : 'No tasks';
      const dismissedText = progress.dismissed ? ` · ${progress.dismissed} dismissed` : '';
      meta.textContent = `${variant?.name ?? 'Type deleted'} · ${resolvedText}${dismissedText} · ${statusLabel}`;
      info.appendChild(title);
      info.appendChild(meta);
      row.appendChild(info);

      const actionRow = document.createElement('div');
      actionRow.className = 'workflow-instance-actions';
      actionRow.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      actionRow.addEventListener('keydown', (event) => {
        event.stopPropagation();
      });
      const hasOptionalEntries = links.some(link => link.if_applicable || link.dismissed_at);

      const manageApplicabilityBtn = document.createElement('button');
      manageApplicabilityBtn.type = 'button';
      manageApplicabilityBtn.className = 'subtle-button';
      manageApplicabilityBtn.textContent = 'Manage optional';
      manageApplicabilityBtn.disabled = !hasOptionalEntries;
      manageApplicabilityBtn.title = hasOptionalEntries
        ? 'Review optional tasks'
        : 'No optional tasks in this workflow';
      manageApplicabilityBtn.addEventListener('click', () => {
        if (!hasOptionalEntries) return;
        openWorkflowApplicabilityModal(instance.id);
      });
      actionRow.appendChild(manageApplicabilityBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-button';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Remove workflow';
      deleteBtn.addEventListener('click', () => {
        const confirmed = confirm(`Remove workflow "${instance.title}"? Tasks will remain.`);
        if (!confirmed) return;
        deleteWorkflowInstanceRecord(instance.id);
        render();
      });
      actionRow.appendChild(deleteBtn);
      row.appendChild(actionRow);
      instanceSection.appendChild(row);
    });
  }
  workflowDetailEl.appendChild(instanceSection);
}

function renderNoticesPageList() {
  if (!noticesListEl) return;
  if (!state.workspace) {
    noticesListEl.innerHTML = '';
    return;
  }
  noticesListEl.innerHTML = '';
  const now = new Date();
  const filterKey = getNoticeFilterKey();
  let notices = (state.notices ?? [])
    .filter(notice => notice.workspace_id === state.workspace.id);
  notices = notices.filter(notice => {
    const isDismissed = Boolean(notice.dismissed_at);
    if (filterKey === 'open') return !isDismissed;
    if (filterKey === 'closed') return isDismissed;
    if (filterKey === 'all') return true;
    if (isDismissed) return false;
    if (!notice.notify_at) return false;
    const notifyAt = new Date(notice.notify_at);
    if (Number.isNaN(notifyAt.getTime())) return false;
    const isToday = notifyAt.toDateString() === now.toDateString();
    if (filterKey === 'today') return isToday;
    if (filterKey === 'overdue') return notifyAt < now && !isToday;
    if (filterKey === 'upcoming') return notifyAt >= now && !isToday;
    return true;
  });

  const sortKey = getNoticeSortKey();
  notices.sort((a, b) => {
    if (sortKey === 'title-asc') {
      return (a.title ?? '').localeCompare(b.title ?? '');
    }
    const aTime = a.notify_at ? new Date(a.notify_at).getTime() : 0;
    const bTime = b.notify_at ? new Date(b.notify_at).getTime() : 0;
    if (sortKey === 'time-desc') return bTime - aTime;
    return aTime - bTime;
  });
  if (!notices.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    if (filterKey === 'closed') {
      empty.textContent = 'No closed notices.';
    } else if (filterKey === 'all') {
      empty.textContent = 'No notices yet.';
    } else if (filterKey === 'open') {
      empty.textContent = 'No open notices.';
    } else {
      empty.textContent = 'No matching notices.';
    }
    noticesListEl.appendChild(empty);
    return;
  }
  notices.forEach(notice => {
    const row = document.createElement('div');
    row.className = 'workspace-row notice-row';
    const info = document.createElement('div');
    info.className = 'notice-row-info';
    info.addEventListener('click', () => openNoticeModalWithNotice(notice));
    const title = document.createElement('div');
    title.className = 'notice-row-title';
    title.textContent = notice.title;
    const meta = document.createElement('div');
    meta.className = 'notice-row-meta';
    const date = new Date(notice.notify_at);
    const dateText = Number.isNaN(date.getTime())
      ? notice.notify_at
      : date.toLocaleString();
    const recurrenceLabel = formatNoticeRecurrence(getNoticeRecurrenceRule(notice));
    const recurrenceText = recurrenceLabel ? ` · repeats ${recurrenceLabel}` : '';
    meta.textContent = `${getNoticeTypeLabel(notice.notice_type)} · ${dateText}${recurrenceText}`;
    info.appendChild(title);
    info.appendChild(meta);

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button menu-icon';
    menuButton.textContent = '⋯';
    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const editItem = document.createElement('button');
    editItem.type = 'button';
    editItem.className = 'workspace-menu-item';
    editItem.textContent = 'Edit';
    editItem.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.classList.add('hidden');
      openMenu = null;
      openNoticeModalWithNotice(notice, { mode: 'edit' });
    });

    const dismissItem = document.createElement('button');
    dismissItem.type = 'button';
    dismissItem.className = 'workspace-menu-item';
    dismissItem.textContent = notice.dismissed_at ? 'Reopen' : 'Dismiss';
    dismissItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      menu.classList.add('hidden');
      openMenu = null;
      if (notice.dismissed_at) {
        await updateNoticeRecord(notice.id, { dismissed_at: null });
      } else {
        await dismissNoticeWithUndo(notice);
      }
    });

    menu.appendChild(editItem);
    menu.appendChild(dismissItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    row.appendChild(info);
    row.appendChild(menuWrapper);
    noticesListEl.appendChild(row);
  });
}

function renderNoticeBellMenu() {
  if (!noticeBellMenu) return;
  if (!state.workspace) {
    noticeBellMenu.innerHTML = '';
    return;
  }
  noticeBellMenu.innerHTML = '';
  const notices = (state.notices ?? [])
    .filter(notice => notice.workspace_id === state.workspace.id && !notice.dismissed_at)
    .sort((a, b) => new Date(a.notify_at).getTime() - new Date(b.notify_at).getTime());
  if (!notices.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No notices.';
    noticeBellMenu.appendChild(empty);
    return;
  }
  notices.forEach(notice => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'workspace-menu-item notice-bell-item';
    const date = new Date(notice.notify_at);
    const dateText = Number.isNaN(date.getTime())
      ? notice.notify_at
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    item.textContent = `${notice.title} · ${dateText}`;
    item.addEventListener('click', () => {
      noticeBellMenu.classList.add('hidden');
      openMenu = null;
      setActiveView('notices');
      openNoticeModalWithNotice(notice);
      render();
    });
    noticeBellMenu.appendChild(item);
  });
}

async function dismissNoticeWithUndo(notice) {
  await updateNoticeRecord(notice.id, { dismissed_at: nowIso() });
  render();
  showUndoToast('Notice dismissed.', async () => {
    await updateNoticeRecord(notice.id, { dismissed_at: null });
    render();
  });
}

function showUndoToast(message, onUndo) {
  if (!undoToastEl) {
    undoToastEl = document.createElement('div');
    undoToastEl.className = 'undo-toast hidden';
    document.body.appendChild(undoToastEl);
  }
  if (undoToastTimer) {
    clearTimeout(undoToastTimer);
    undoToastTimer = null;
  }
  undoToastEl.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = 'Undo';
  undoBtn.className = 'subtle-button';
  undoBtn.addEventListener('click', async () => {
    if (undoToastTimer) {
      clearTimeout(undoToastTimer);
      undoToastTimer = null;
    }
    undoToastEl.classList.add('hidden');
    await onUndo();
  });
  undoToastEl.appendChild(text);
  undoToastEl.appendChild(undoBtn);
  undoToastEl.classList.remove('hidden');
  undoToastTimer = setTimeout(() => {
    undoToastEl.classList.add('hidden');
  }, 5000);
}

function clearShoppingListDropTargets() {
  if (!shoppingListListEl) return;
  shoppingListListEl.querySelectorAll('.workspace-row.is-drop-target')
    .forEach((row) => row.classList.remove('is-drop-target'));
}

function renderShoppingListList() {
  if (!shoppingListListEl) return;
  if (!state.workspace) {
    shoppingListListEl.innerHTML = '';
    return;
  }
  shoppingListListEl.innerHTML = '';
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  if (showArchivedShoppingToggle) {
    showArchivedShoppingToggle.checked = showArchived;
  }
  const lists = (state.shoppingLists ?? []).filter(list =>
    list.workspace_id === state.workspace.id && shouldShowShoppingListInSidebar(list, { showArchived })
  ).sort((a, b) => {
    const aInbox = isShoppingInboxList(a) ? 1 : 0;
    const bInbox = isShoppingInboxList(b) ? 1 : 0;
    if (aInbox !== bInbox) return bInbox - aInbox;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
  const activeList = getActiveShoppingList();
  if (activeList) {
    state.ui.activeShoppingListId = activeList.id;
  }
  if (!lists.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No shopping lists yet.';
    shoppingListListEl.appendChild(empty);
    return;
  }
  lists.forEach(list => {
    const row = document.createElement('div');
    row.className = 'workspace-row' + (activeList?.id === list.id ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    const isInboxList = isShoppingInboxList(list);
    const listLabel = isInboxList ? 'Inbox' : list.name;
    selectBtn.textContent = list.archived ? `${listLabel} (completed)` : listLabel;
    selectBtn.addEventListener('click', () => {
      state.ui.activeShoppingListId = list.id;
      if (isMobileViewport()) {
        setMobileShoppingPanelMode('details');
      } else {
        setShoppingPageMode('details');
      }
      setActiveView('shopping');
      render();
    });

    const canAcceptInboxDrop = !isShoppingInboxList(list) && !list.archived;
    if (canAcceptInboxDrop) {
      row.addEventListener('dragover', (event) => {
        if (!draggingShoppingInboxItemId) return;
        event.preventDefault();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', (event) => {
        if (!draggingShoppingInboxItemId) return;
        const related = event.relatedTarget;
        if (related instanceof Node && row.contains(related)) return;
        row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', async (event) => {
        if (!draggingShoppingInboxItemId) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('is-drop-target');
        const moved = await moveShoppingInboxItemToList(draggingShoppingInboxItemId, list.id);
        draggingShoppingInboxItemId = null;
        clearShoppingListDropTargets();
        if (!moved) {
          showToast({ type: 'error', message: 'Could not assign this inbox item.' });
          return;
        }
        showToast({ type: 'success', message: 'Inbox item assigned.' });
        setActiveView('shopping');
        render();
      });
    }

    row.appendChild(selectBtn);
    shoppingListListEl.appendChild(row);
  });
}

function renderShoppingPanel() {
  if (!shoppingPage) return;
  const isMobileShopping = isMobileViewport();
  const desktopMode = getShoppingPageMode();
  const mobileMode = isMobileShopping ? getMobileShoppingPanelMode() : 'details';
  const showListMode = (isMobileShopping && mobileMode === 'list') || (!isMobileShopping && desktopMode === 'list');
  const isShoppingView = getActiveView() === 'shopping';
  const activeList = getActiveShoppingList();
  const showMobileBack = isShoppingView && isMobileShopping && mobileMode === 'details' && !showListMode;
  shoppingMobileBackRow?.classList.toggle('hidden', !showMobileBack);
  if (shoppingMobileBack) {
    shoppingMobileBack.classList.toggle('hidden', !showMobileBack);
  }

  if (showListMode) {
    shoppingPage.classList.remove('is-empty');
    shoppingListTitle.textContent = 'Shopping Lists';
    shoppingListSubtitle.textContent = 'Select a list to view its checklist.';
    shoppingListMenuButton?.classList.add('hidden');
    shoppingListMenu?.classList.add('hidden');
    shoppingCompleteBtn?.classList.add('hidden');
    shoppingAddBtn?.classList.add('hidden');
    shoppingFilterButton?.classList.remove('hidden');
    shoppingListItemsEl.innerHTML = '';
    const filterKey = getShoppingFilterKey();
    const lists = (state.shoppingLists ?? [])
      .filter(list => list.workspace_id === state.workspace?.id)
      .filter((list) => {
        if (!isShoppingInboxList(list)) return true;
        return getShoppingItemsForList(list.id).length > 0;
      })
      .filter((list) => {
        const closed = isShoppingListClosed(list);
        if (filterKey === 'open') return !closed;
        if (filterKey === 'closed') return closed;
        return true;
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    if (!lists.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-note';
      if (filterKey === 'closed') {
        empty.textContent = 'No completed lists.';
      } else if (filterKey === 'all') {
        empty.textContent = 'No shopping lists yet.';
      } else {
        empty.textContent = 'No open lists.';
      }
      shoppingListItemsEl.appendChild(empty);
      return;
    }
    lists.forEach((list) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'workspace-row shopping-mobile-row';
      if (activeList?.id === list.id) row.classList.add('active');
      const name = document.createElement('span');
      name.className = 'shopping-mobile-row-name';
      name.textContent = isShoppingInboxList(list) ? 'Inbox' : list.name;
      const meta = document.createElement('span');
      meta.className = 'shopping-mobile-row-meta';
      const itemCount = getShoppingItemsForList(list.id).length;
      const closed = isShoppingListClosed(list);
      meta.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}${closed ? ' · complete' : ''}`;
      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener('click', () => {
        state.ui = state.ui ?? {};
        state.ui.activeShoppingListId = list.id;
        if (isMobileShopping) {
          setMobileShoppingPanelMode('details');
        } else {
          setShoppingPageMode('details');
        }
        render();
      });
      shoppingListItemsEl.appendChild(row);
    });
    return;
  }

  shoppingFilterButton?.classList.add('hidden');
  shoppingFilterMenu?.classList.add('hidden');
  if (openMenu === shoppingFilterMenu) {
    openMenu = null;
  }

  if (isMobileShopping && !activeList) {
    setMobileShoppingPanelMode('list');
  }
  if (!activeList) {
    shoppingPage.classList.add('is-empty');
    shoppingListTitle.textContent = 'Shopping Lists';
    shoppingListSubtitle.textContent = 'Select a shopping list to view items.';
    shoppingListItemsEl.innerHTML = '';
    shoppingListMenuButton?.classList.add('hidden');
    shoppingListMenu?.classList.add('hidden');
    shoppingCompleteBtn?.classList.add('hidden');
    shoppingAddBtn?.classList.add('hidden');
    return;
  }

  shoppingPage.classList.remove('is-empty');
  const activeIsInbox = isShoppingInboxList(activeList);
  const inboxTargetLists = activeIsInbox
    ? getShoppingTargetLists().sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
    : [];
  shoppingListTitle.textContent = activeIsInbox ? 'Shopping Inbox' : activeList.name;
  const items = getShoppingItemsForList(activeList.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const complete = isShoppingListComplete(activeList.id);
  shoppingListSubtitle.textContent = activeIsInbox
    ? `${items.length} item${items.length === 1 ? '' : 's'} waiting assignment`
    : `${items.length} items${complete ? ' · complete' : ''}${activeList.archived ? ' · completed' : ''}`;
  shoppingListMenuButton?.classList.remove('hidden');
  shoppingCompleteBtn?.classList.toggle('hidden', activeIsInbox);
  shoppingAddBtn?.classList.toggle('hidden', activeIsInbox);
  if (shoppingCompleteBtn && !activeIsInbox) {
    shoppingCompleteBtn.disabled = items.length === 0;
  }
  if (activeList.archived) {
    shoppingAddBtn?.classList.add('hidden');
    shoppingCompleteBtn.disabled = true;
  }
  if (activeIsInbox) {
    shoppingListMenuButton?.classList.add('hidden');
    shoppingListMenu?.classList.add('hidden');
  }

  shoppingListItemsEl.innerHTML = '';
  if (activeIsInbox && !inboxTargetLists.length) {
    const helper = document.createElement('div');
    helper.className = 'sidebar-note';
    helper.textContent = 'Create a shopping list first, then move inbox items into it.';
    shoppingListItemsEl.appendChild(helper);
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shopping-item' + (item.is_checked ? ' is-checked' : '');
    const label = document.createElement('span');
    label.className = 'shopping-item-label';
    label.textContent = item.name;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-button shopping-item-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Remove item';
    deleteBtn.addEventListener('click', async () => {
      await deleteShoppingItemRecord(item.id);
      render();
    });

    if (activeIsInbox) {
      row.classList.remove('is-checked');
      row.classList.add('shopping-item-inbox');
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        draggingShoppingInboxItemId = item.id;
        row.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', item.id);
        }
      });
      row.addEventListener('dragend', () => {
        draggingShoppingInboxItemId = null;
        row.classList.remove('is-dragging');
        clearShoppingListDropTargets();
      });
      const assignSelect = document.createElement('select');
      assignSelect.className = 'setting-input shopping-item-assign';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Assign to store...';
      assignSelect.appendChild(placeholder);
      inboxTargetLists.forEach((list) => {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = list.name;
        assignSelect.appendChild(option);
      });
      const suggestedListId = getSuggestedShoppingListIdForItems([item.name], inboxTargetLists);
      if (suggestedListId && inboxTargetLists.some((list) => list.id === suggestedListId)) {
        assignSelect.value = suggestedListId;
      }
      assignSelect.disabled = inboxTargetLists.length === 0;

      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'subtle-button';
      moveBtn.textContent = 'Assign';
      moveBtn.disabled = inboxTargetLists.length === 0;
      moveBtn.addEventListener('click', async () => {
        const selectedListId = String(assignSelect.value ?? '').trim();
        if (!selectedListId) return;
        const moved = await moveShoppingInboxItemToList(item.id, selectedListId);
        if (!moved) {
          showToast({ type: 'error', message: 'Could not move this item yet.' });
          return;
        }
        showToast({ type: 'success', message: 'Inbox item assigned.' });
        render();
      });

      row.appendChild(label);
      row.appendChild(assignSelect);
      row.appendChild(moveBtn);
      row.appendChild(deleteBtn);
    } else {
      row.draggable = false;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.is_checked);
      checkbox.addEventListener('change', async () => {
        await updateShoppingItemRecord(item.id, { is_checked: checkbox.checked ? 1 : 0 });
        render();
      });
      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(deleteBtn);
    }
    shoppingListItemsEl.appendChild(row);
  });
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = activeIsInbox
      ? 'No inbox items. Add with Quick Add in the sidebar.'
      : 'No items yet. Add a few below.';
    shoppingListItemsEl.appendChild(empty);
  }
}

function renderNotificationStatus() {
  if (!notificationStatus || !enableNotificationsBtn) return;
  if (!('Notification' in window)) {
    notificationStatus.textContent = 'Notifications not supported in this browser.';
    return;
  }
  const permission = Notification.permission;
  const enabled = Boolean(state.ui?.notificationsEnabled);
  enableNotificationsBtn.checked = enabled;
  if (permission === 'granted' && enabled) {
    notificationStatus.textContent = 'Notifications enabled.';
    return;
  }
  if (permission === 'denied') {
    notificationStatus.textContent = 'Notifications blocked in browser settings.';
    return;
  }
  notificationStatus.textContent = enabled ? 'Permission pending.' : 'Notifications off.';
}

function renderTaskList(roots) {
  const inlineAddDisabled = isMobileViewport();
  const checklistInstanceId = getActiveWorkflowChecklistInstanceId();
  const quickAddVisible = !checklistInstanceId && getTaskQuickAddVisible();
  const appCompletedVisibility = getTaskCompletedVisibility();
  const appFutureVisibilityDays = getTaskFutureVisibilityDays();
  const smartPrioritized = getTaskView() === 'smart';
  const groupMode = checklistInstanceId
    ? 'workflow-phase'
    : (smartPrioritized ? 'none' : getTaskGroupMode());
  if (groupMode === 'none') {
    const topDropzone = document.createElement('div');
    topDropzone.className = 'task-root-dropzone';
    attachTaskDropzone(topDropzone, { parentId: null });
    taskTreeEl.appendChild(topDropzone);
  }

  const list = document.createElement('div');
  list.className = 'task-list';
  const appendTaskNode = (container, task, options = {}) => {
    const rendered = renderTask(task, {
      completedVisibility: options.completedVisibility ?? appCompletedVisibility,
      futureVisibilityDays: options.futureVisibilityDays ?? appFutureVisibilityDays
    });
    if (rendered) container.appendChild(rendered);
  };
  if (groupMode === 'none') {
    attachTaskDropzone(list, { parentId: null });
  }
  let defaultGroupList = null;
  if (groupMode === 'section') {
    const sections = getSectionsForWorkspace();
    const sectionScopeProjectId = getActiveTaskSectionScopeProjectId();
    const grouped = new Map();
    const ungrouped = [];

    roots.forEach(task => {
      const label = (task.group_label ?? '').trim();
      if (!label) {
        ungrouped.push(task);
        return;
      }
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(task);
    });

    const createSectionAddRow = (sectionLabel) => {
      const addRow = document.createElement('div');
      addRow.className = 'task-add-subtask task-add-task task-add-section-task';
      const addInput = document.createElement('input');
      addInput.type = 'text';
      addInput.className = 'task-add-input';
      addInput.placeholder = 'Add task...';
      attachQuickAddClick(addInput);
      addInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const title = addInput.value.trim();
          if (!title) return;
          await createTaskRecord({
            title,
            group_label: sectionLabel,
            project_id: sectionScopeProjectId
          });
          addInput.value = '';
          render();
        }
        if (event.key === 'Escape') {
          addInput.value = '';
          addInput.blur();
        }
      });
      addRow.appendChild(addInput);
      return addRow;
    };

    sections.forEach(sectionInfo => {
      const label = sectionInfo.label;
      const isPersisted = isPersistedSection(sectionInfo);
      const section = document.createElement('div');
      section.className = 'task-group-section';
      if (isPersisted) {
        section.dataset.sectionId = sectionInfo.id;
      }
      section.dataset.groupMode = 'section';
      section.dataset.groupValue = label;
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'task-group-header';
      const dragHandle = document.createElement('span');
      dragHandle.className = 'section-drag-handle';
      dragHandle.textContent = '⋮⋮';
      if (isPersisted) {
        dragHandle.draggable = true;
        dragHandle.addEventListener('dragstart', (event) => beginSectionDrag(event, sectionInfo.id, section));
        dragHandle.addEventListener('dragend', endSectionDrag);
      }
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      if (isPersisted) {
        sectionHeader.appendChild(dragHandle);
      }
      sectionHeader.appendChild(labelSpan);
      sectionHeader.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showTaskGroupContextMenu(sectionInfo, event.clientX, event.clientY);
      });
      if (isPersisted) {
        section.addEventListener('dragover', (event) => {
          if (!draggingSectionEl || draggingTaskId || draggingColumnKey) return;
          if (section === draggingSectionEl) return;
          event.preventDefault();
          const rect = section.getBoundingClientRect();
          const insertAfter = event.clientY > rect.top + rect.height / 2;
          const parent = section.parentElement;
          if (!parent) return;
          parent.insertBefore(draggingSectionEl, insertAfter ? section.nextSibling : section);
          sectionOrderDirty = true;
        });
        section.addEventListener('drop', (event) => {
          if (!draggingSectionEl || draggingTaskId || draggingColumnKey) return;
          event.preventDefault();
          if (sectionOrderDirty) {
            persistSectionOrder(section.parentElement);
            sectionOrderDirty = false;
          }
        });
      }
      section.appendChild(sectionHeader);
      const groupList = document.createElement('div');
      groupList.className = 'task-group-list';
      attachTaskDropzone(groupList, { parentId: null, groupMode: 'section', groupValue: label });
      const sectionCompletedVisibility = getTaskSectionCompletedVisibility(sectionInfo);
      const sectionFutureVisibilityDays = getTaskSectionFutureVisibilityDays(sectionInfo);
      (grouped.get(label) ?? []).forEach(node => appendTaskNode(groupList, node, {
        completedVisibility: sectionCompletedVisibility,
        futureVisibilityDays: sectionFutureVisibilityDays
      }));
      if (!inlineAddDisabled && quickAddVisible) {
        groupList.appendChild(createSectionAddRow(label));
      }
      section.appendChild(groupList);
      list.appendChild(section);
    });

    if (ungrouped.length) {
      const ungroupedList = document.createElement('div');
      ungroupedList.className = 'task-group-list task-ungrouped-list';
      attachTaskDropzone(ungroupedList, { parentId: null, groupMode: 'section', groupValue: null });
      ungrouped.forEach(node => appendTaskNode(ungroupedList, node));
      list.appendChild(ungroupedList);
    }

    const addSectionRow = document.createElement('div');
    addSectionRow.className = 'task-add-section';
    const addSectionInput = document.createElement('input');
    addSectionInput.type = 'text';
    addSectionInput.className = 'task-add-input';
    addSectionInput.placeholder = 'Add section...';
    addSectionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const name = addSectionInput.value.trim();
        if (!name) return;
        createSectionRecord(name);
        addSectionInput.value = '';
        render();
      }
      if (event.key === 'Escape') {
        addSectionInput.value = '';
        addSectionInput.blur();
      }
    });
    addSectionRow.appendChild(addSectionInput);

    if (!sections.length && !inlineAddDisabled && quickAddVisible) {
      const addRow = document.createElement('div');
      addRow.className = 'task-add-subtask task-add-task';
      const addInput = document.createElement('input');
      addInput.type = 'text';
      addInput.className = 'task-add-input';
      addInput.placeholder = 'Add task...';
      attachQuickAddClick(addInput);
      addInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const title = addInput.value.trim();
          if (!title) return;
          await createTaskRecord({
            title,
            project_id: sectionScopeProjectId
          });
          addInput.value = '';
          render();
        }
        if (event.key === 'Escape') {
          addInput.value = '';
          addInput.blur();
        }
      });
      addRow.appendChild(addInput);
      list.appendChild(addRow);
    }
    if (!inlineAddDisabled) {
      list.appendChild(addSectionRow);
    }
  } else if (groupMode === 'workflow-phase') {
    const phaseOrder = new Map();
    const instance = checklistInstanceId ? getWorkflowInstanceById(checklistInstanceId) : null;
    if (instance?.variant_id) {
      getWorkflowVariantPhases(instance.variant_id).forEach((entry, index) => {
        phaseOrder.set(entry.phase.id, { label: entry.phase.name, sort: index });
      });
    }

    const grouped = new Map();
    const ungrouped = [];
    const getPhaseInfoForTask = (taskId) => {
      let currentId = taskId;
      let guard = 0;
      while (currentId && guard < 200) {
        const link = getWorkflowInstanceLinkByTaskId(currentId);
        if (link && link.workflow_instance_id === checklistInstanceId) {
          const phaseId = link.phase_id ?? null;
          if (!phaseId) return null;
          const known = phaseOrder.get(phaseId);
          if (known) {
            return {
              id: phaseId,
              label: known.label,
              sort: known.sort
            };
          }
          const phase = getWorkflowPhaseById(phaseId);
          return {
            id: phaseId,
            label: phase?.name ?? 'Phase',
            sort: Number.MAX_SAFE_INTEGER
          };
        }
        currentId = state.tasks?.[currentId]?.parent_id ?? null;
        guard += 1;
      }
      return null;
    };

    roots.forEach(task => {
      const phaseInfo = getPhaseInfoForTask(task.id);
      if (!phaseInfo) {
        ungrouped.push(task);
        return;
      }
      if (!grouped.has(phaseInfo.id)) {
        grouped.set(phaseInfo.id, { ...phaseInfo, tasks: [] });
      }
      grouped.get(phaseInfo.id).tasks.push(task);
    });

    phaseOrder.forEach((meta, phaseId) => {
      if (!grouped.has(phaseId)) {
        grouped.set(phaseId, {
          id: phaseId,
          label: meta.label,
          sort: meta.sort,
          tasks: []
        });
      }
    });

    const groups = Array.from(grouped.values()).sort((a, b) => {
      const sortDiff = (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER);
      if (sortDiff !== 0) return sortDiff;
      return a.label.localeCompare(b.label);
    });

    groups.forEach(group => {
      const section = document.createElement('div');
      section.className = 'task-group-section';
      section.dataset.groupMode = 'workflow-phase';
      section.dataset.groupValue = group.id ?? '';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'task-group-header';
      sectionHeader.textContent = group.label;
      section.appendChild(sectionHeader);

      const groupList = document.createElement('div');
      groupList.className = 'task-group-list';
      attachTaskDropzone(groupList, {
        parentId: null,
        groupMode: 'workflow-phase',
        groupValue: group.id
      });
      group.tasks.forEach(node => appendTaskNode(groupList, node));
      section.appendChild(groupList);
      list.appendChild(section);
    });

    if (ungrouped.length) {
      const ungroupedList = document.createElement('div');
      ungroupedList.className = 'task-group-list task-ungrouped-list';
      attachTaskDropzone(ungroupedList, { parentId: null });
      ungrouped.forEach(node => appendTaskNode(ungroupedList, node));
      list.appendChild(ungroupedList);
    }
  } else if (groupMode !== 'none') {
    const grouped = new Map();
    const priorityOrder = ['critical', 'high', 'medium', 'low'];
    const priorityLabel = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low'
    };
    const getGroupInfo = (task) => {
      if (groupMode === 'task-type') {
        const value = (task.type_label ?? '').trim();
        return {
          key: value || '__none__',
          value: value || null,
          label: value || 'No type'
        };
      }
      if (groupMode === 'priority') {
        const value = (task.priority ?? 'medium') || 'medium';
        return {
          key: value,
          value,
          label: priorityLabel[value] ?? value
        };
      }
      return { key: '__none__', value: null, label: 'No type' };
    };

    roots.forEach(task => {
      const info = getGroupInfo(task);
      if (!grouped.has(info.key)) {
        grouped.set(info.key, { ...info, tasks: [] });
      }
      grouped.get(info.key).tasks.push(task);
    });

    if (groupMode === 'task-type' && !grouped.has('__none__')) {
      grouped.set('__none__', { key: '__none__', value: null, label: 'No type', tasks: [] });
    }
    if (groupMode === 'priority' && !grouped.has('medium')) {
      grouped.set('medium', { key: 'medium', value: 'medium', label: 'Medium', tasks: [] });
    }

    let groups = Array.from(grouped.values());
    if (groupMode === 'priority') {
      groups = groups.sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.value);
        const bIndex = priorityOrder.indexOf(b.value);
        if (aIndex === -1 && bIndex === -1) return a.label.localeCompare(b.label);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    } else {
      groups = groups.sort((a, b) => {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return a.label.localeCompare(b.label);
      });
    }

    groups.forEach(group => {
      const section = document.createElement('div');
      section.className = 'task-group-section';
      section.dataset.groupMode = groupMode;
      section.dataset.groupValue = group.value ?? '';
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'task-group-header';
      sectionHeader.textContent = group.label;
      // non-section group headers do not support rename
      section.appendChild(sectionHeader);
      const groupList = document.createElement('div');
      groupList.className = 'task-group-list';
      attachTaskDropzone(groupList, {
        parentId: null,
        groupMode,
        groupValue: group.value
      });
      group.tasks.forEach(node => appendTaskNode(groupList, node));
      section.appendChild(groupList);
      list.appendChild(section);
      if (group.key === '__none__' || groupMode === 'priority' && group.value === 'medium') {
        defaultGroupList = groupList;
      }
    });
  } else {
    roots.forEach(node => appendTaskNode(list, node));
  }
  let addInput = null;
  if (quickAddVisible && !inlineAddDisabled) {
    const addRow = document.createElement('div');
    addRow.className = 'task-add-subtask task-add-task';
    addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'task-add-input';
    addInput.placeholder = 'Add task...';
    addInput.value = state.ui?.taskAddDraft ?? '';
    attachQuickAddClick(addInput);
    addInput.addEventListener('focus', () => {
      state.ui = state.ui ?? {};
      state.ui.taskAddFocused = true;
    });
    addInput.addEventListener('blur', () => {
      if (!state.ui) return;
      state.ui.taskAddFocused = false;
    });
    addInput.addEventListener('input', () => {
      state.ui = state.ui ?? {};
      state.ui.taskAddDraft = addInput.value;
    });
    addInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const title = addInput.value.trim();
        if (!title) return;
        await createTaskRecord({ title });
        addInput.value = '';
        state.ui = state.ui ?? {};
        state.ui.taskAddDraft = '';
        state.ui = state.ui ?? {};
        state.ui.focusTaskAdd = true;
        render();
      }
      if (event.key === 'Escape') {
        addInput.value = '';
        if (state.ui) state.ui.taskAddDraft = '';
        addInput.blur();
      }
    });
    addRow.appendChild(addInput);
    if (groupMode === 'none' || (groupMode !== 'section' && groupMode !== 'none')) {
      if (groupMode === 'none') {
        list.appendChild(addRow);
      } else {
        (defaultGroupList ?? list).appendChild(addRow);
      }
    }
  }
  taskTreeEl.appendChild(list);

  if (groupMode === 'none') {
    const bottomDropzone = document.createElement('div');
    bottomDropzone.className = 'task-root-dropzone';
    attachTaskDropzone(bottomDropzone, { parentId: null });
    taskTreeEl.appendChild(bottomDropzone);
  }

  if (addInput && (state.ui?.focusTaskAdd || state.ui?.taskAddFocused)) {
    state.ui = state.ui ?? {};
    state.ui.focusTaskAdd = false;
    state.ui.taskAddFocused = true;
    setTimeout(() => addInput.focus(), 0);
  } else if (!addInput && state.ui?.focusTaskAdd) {
    state.ui = state.ui ?? {};
    state.ui.focusTaskAdd = false;
    state.ui.taskAddFocused = false;
  }
}

function getCalendarMonth() {
  const value = state.ui?.calendarMonth ?? null;
  if (value) {
    const date = new Date(`${value}-01T00:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function getSchedulingCalendarMonth() {
  const value = state.ui?.schedulingCalendarMonth ?? null;
  if (value) {
    const date = new Date(`${value}-01T00:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function setSchedulingCalendarMonth(date) {
  state.ui = state.ui ?? {};
  const month = String(date.getMonth() + 1).padStart(2, '0');
  state.ui.schedulingCalendarMonth = `${date.getFullYear()}-${month}`;
}

function getSchedulingCalendarWeekStart() {
  const value = state.ui?.schedulingCalendarWeekStart ?? null;
  if (value) {
    const parsed = getWeekStartDate(`${value}T00:00:00`);
    if (parsed) return parsed;
  }
  return getWeekStartDate(new Date()) ?? new Date();
}

function setSchedulingCalendarWeekStart(date) {
  const weekStart = getWeekStartDate(date);
  if (!weekStart) return;
  state.ui = state.ui ?? {};
  const y = weekStart.getFullYear();
  const m = String(weekStart.getMonth() + 1).padStart(2, '0');
  const d = String(weekStart.getDate()).padStart(2, '0');
  state.ui.schedulingCalendarWeekStart = `${y}-${m}-${d}`;
  setSchedulingCalendarMonth(weekStart);
}

function getSchedulingCalendarDay() {
  const value = state.ui?.schedulingCalendarDay ?? null;
  if (value) {
    const parsed = parseDateOnlyValue(value);
    if (parsed) return parsed;
  }
  const weekStart = getSchedulingCalendarWeekStart();
  return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0, 0);
}

function setSchedulingCalendarDay(date) {
  const parsed = parseDateOnlyValue(formatDateOnlyValue(new Date(date)));
  if (!parsed) return;
  state.ui = state.ui ?? {};
  state.ui.schedulingCalendarDay = formatDateOnlyValue(parsed);
  setSchedulingCalendarMonth(parsed);
  setSchedulingCalendarWeekStart(parsed);
}

function getSchedulingCalendarRange() {
  const value = state.ui?.schedulingCalendarRange;
  if (value === 'week' || value === 'day') return value;
  return 'month';
}

function setSchedulingCalendarRange(value) {
  const next = value === 'week' || value === 'day' ? value : 'month';
  state.ui = state.ui ?? {};
  state.ui.schedulingCalendarRange = next;
  if ((next === 'week' || next === 'day') && !state.ui.schedulingCalendarWeekStart) {
    setSchedulingCalendarWeekStart(new Date());
  }
  if (next === 'day' && !state.ui.schedulingCalendarDay) {
    setSchedulingCalendarDay(new Date());
  }
}

function setCalendarMonth(date) {
  state.ui = state.ui ?? {};
  const month = String(date.getMonth() + 1).padStart(2, '0');
  state.ui.calendarMonth = `${date.getFullYear()}-${month}`;
}

function getWeekStartDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function getCalendarWeekStart() {
  const value = state.ui?.calendarWeekStart ?? null;
  if (value) {
    const parsed = getWeekStartDate(`${value}T00:00:00`);
    if (parsed) return parsed;
  }
  return getWeekStartDate(new Date()) ?? new Date();
}

function setCalendarWeekStart(date) {
  const weekStart = getWeekStartDate(date);
  if (!weekStart) return;
  state.ui = state.ui ?? {};
  const y = weekStart.getFullYear();
  const m = String(weekStart.getMonth() + 1).padStart(2, '0');
  const d = String(weekStart.getDate()).padStart(2, '0');
  state.ui.calendarWeekStart = `${y}-${m}-${d}`;
  setCalendarMonth(weekStart);
}

function getCalendarDay() {
  const value = state.ui?.calendarDay ?? null;
  if (value) {
    const parsed = parseDateOnlyValue(value);
    if (parsed) return parsed;
  }
  const weekStart = getCalendarWeekStart();
  return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0, 0);
}

function setCalendarDay(date) {
  const parsed = parseDateOnlyValue(formatDateOnlyValue(new Date(date)));
  if (!parsed) return;
  state.ui = state.ui ?? {};
  state.ui.calendarDay = formatDateOnlyValue(parsed);
  setCalendarMonth(parsed);
  setCalendarWeekStart(parsed);
}

function getCalendarRange() {
  const value = state.ui?.calendarRange;
  if (value === 'week' || value === 'day') return value;
  return 'month';
}

function setCalendarRange(value) {
  const next = value === 'week' || value === 'day' ? value : 'month';
  state.ui = state.ui ?? {};
  state.ui.calendarRange = next;
  if ((next === 'week' || next === 'day') && !state.ui.calendarWeekStart) {
    setCalendarWeekStart(new Date());
  }
  if (next === 'day' && !state.ui.calendarDay) {
    setCalendarDay(new Date());
  }
}

function formatDateOnlyValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnlyValue(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return date;
}

function parseMonthValue(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const date = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex) return null;
  return date;
}

function getCalendarIncludeHolidays() {
  return Boolean(state.ui?.calendarIncludeHolidays);
}

function setCalendarIncludeHolidays(value) {
  state.ui = state.ui ?? {};
  state.ui.calendarIncludeHolidays = Boolean(value);
}

function normalizeHiddenHolidayKeys(value) {
  if (!Array.isArray(value)) return [];
  const hidden = [];
  const seen = new Set();
  value.forEach((entry) => {
    const key = String(entry ?? '').trim();
    if (!key || seen.has(key) || !US_HOLIDAY_RULE_KEYS.has(key)) return;
    seen.add(key);
    hidden.push(key);
  });
  return hidden;
}

function getCalendarHiddenHolidayKeys() {
  return normalizeHiddenHolidayKeys(state.ui?.calendarHiddenHolidayKeys);
}

function setCalendarHiddenHolidayKeys(value) {
  state.ui = state.ui ?? {};
  state.ui.calendarHiddenHolidayKeys = normalizeHiddenHolidayKeys(value);
}

function getCalendarIncludeNotices() {
  return state.ui?.calendarIncludeNotices !== false;
}

function setCalendarIncludeNotices(value) {
  state.ui = state.ui ?? {};
  state.ui.calendarIncludeNotices = Boolean(value);
}

function getNthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  if (nth <= 0) return null;
  const date = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const firstOffset = (7 + weekday - date.getDay()) % 7;
  date.setDate(1 + firstOffset + (nth - 1) * 7);
  if (date.getMonth() !== monthIndex) return null;
  return date;
}

function getLastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function getChineseNewYearDate(year) {
  if (!CHINESE_CALENDAR_FORMATTER) return null;
  for (let monthIndex = 0; monthIndex <= 1; monthIndex += 1) {
    const startDay = monthIndex === 0 ? 21 : 1;
    const endDay = monthIndex === 0 ? 31 : 20;
    for (let day = startDay; day <= endDay; day += 1) {
      const candidate = new Date(year, monthIndex, day, 12, 0, 0, 0);
      if (Number.isNaN(candidate.getTime())) continue;
      const parts = CHINESE_CALENDAR_FORMATTER.formatToParts(candidate);
      const monthPart = parts.find(part => part.type === 'month')?.value ?? '';
      const dayPart = parts.find(part => part.type === 'day')?.value ?? '';
      const lunarMonth = Number.parseInt(monthPart, 10);
      const lunarDay = Number.parseInt(dayPart, 10);
      if (lunarMonth === 1 && lunarDay === 1) {
        return candidate;
      }
    }
  }
  return null;
}

function getUsHolidayDefinitionsForYear(year) {
  const hiddenKeys = new Set(getCalendarHiddenHolidayKeys());
  return US_HOLIDAY_RULES
    .filter(rule => !hiddenKeys.has(rule.key))
    .map(rule => ({
      key: rule.key,
      title: rule.title,
      date: rule.getDate(year)
    }))
    .filter(entry => entry.date && !Number.isNaN(entry.date.getTime()));
}

function getHolidayEntriesInRange(rangeStart, rangeEnd) {
  const startTime = rangeStart?.getTime?.();
  const endTime = rangeEnd?.getTime?.();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  const startYear = rangeStart.getFullYear();
  const endYear = rangeEnd.getFullYear();
  const entries = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const holidays = getUsHolidayDefinitionsForYear(year);
    holidays.forEach((holiday) => {
      const time = holiday.date.getTime();
      if (time < startTime || time > endTime) return;
      entries.push({
        id: `holiday-${holiday.key}-${year}`,
        title: holiday.title,
        date: holiday.date
      });
    });
  }
  return entries;
}

function getScheduleEventDateRange(event, rangeStart, rangeEnd) {
  const startDate = event?.start_at ? new Date(event.start_at) : null;
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return [];
  const endDate = event?.end_at ? new Date(event.end_at) : startDate;
  if (Number.isNaN(endDate.getTime())) return [];
  const rangeStartDay = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 0, 0, 0, 0);
  const rangeEndDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999);
  const eventStartDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
  const eventEndDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
  if (eventEndDay.getTime() < rangeStartDay.getTime() || eventStartDay.getTime() > rangeEndDay.getTime()) {
    return [];
  }
  const dates = [];
  const cursor = new Date(Math.max(eventStartDay.getTime(), rangeStartDay.getTime()));
  const finalTime = Math.min(eventEndDay.getTime(), rangeEndDay.getTime());
  while (cursor.getTime() <= finalTime) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getScheduleEventOccurrencesInRange(event, rangeStart, rangeEnd) {
  const startDate = event?.start_at ? new Date(event.start_at) : null;
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return [];
  const endDate = event?.end_at ? new Date(event.end_at) : new Date(startDate.getTime());
  if (Number.isNaN(endDate.getTime())) return [];
  const normalizedRangeStart = rangeStart instanceof Date && !Number.isNaN(rangeStart.getTime())
    ? rangeStart
    : new Date(startDate.getTime());
  const normalizedRangeEnd = rangeEnd instanceof Date && !Number.isNaN(rangeEnd.getTime())
    ? rangeEnd
    : new Date(endDate.getTime());
  if (normalizedRangeEnd.getTime() < normalizedRangeStart.getTime()) return [];

  const recurrenceInterval = normalizeScheduleEventRecurrenceInterval(event?.recurrence_interval);
  const recurrenceUnit = normalizeScheduleEventRecurrenceUnit(event?.recurrence_unit);
  const overlapsRange = (occurrenceStart, occurrenceEnd) =>
    occurrenceEnd.getTime() >= normalizedRangeStart.getTime()
    && occurrenceStart.getTime() <= normalizedRangeEnd.getTime();

  if (!recurrenceInterval || !recurrenceUnit) {
    return overlapsRange(startDate, endDate)
      ? [{ start: new Date(startDate.getTime()), end: new Date(endDate.getTime()) }]
      : [];
  }

  const occurrences = [];
  let cursorStart = new Date(startDate.getTime());
  let cursorEnd = new Date(endDate.getTime());
  let guard = 0;

  while (guard < 5000 && cursorEnd.getTime() < normalizedRangeStart.getTime()) {
    const nextStart = addInterval(cursorStart, recurrenceInterval, recurrenceUnit);
    const nextEnd = addInterval(cursorEnd, recurrenceInterval, recurrenceUnit);
    if (nextStart.getTime() <= cursorStart.getTime() || nextEnd.getTime() <= cursorEnd.getTime()) break;
    cursorStart = nextStart;
    cursorEnd = nextEnd;
    guard += 1;
  }

  while (guard < 10000 && cursorStart.getTime() <= normalizedRangeEnd.getTime()) {
    if (overlapsRange(cursorStart, cursorEnd)) {
      occurrences.push({
        start: new Date(cursorStart.getTime()),
        end: new Date(cursorEnd.getTime())
      });
    }
    const nextStart = addInterval(cursorStart, recurrenceInterval, recurrenceUnit);
    const nextEnd = addInterval(cursorEnd, recurrenceInterval, recurrenceUnit);
    if (nextStart.getTime() <= cursorStart.getTime() || nextEnd.getTime() <= cursorEnd.getTime()) break;
    cursorStart = nextStart;
    cursorEnd = nextEnd;
    guard += 1;
  }

  return occurrences;
}

function getDateIsoKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatCalendarHourLabel(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const base = normalized % 12 || 12;
  return `${base} ${suffix}`;
}

function formatCalendarTimeLabel(date, timeZone = null) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const options = { hour: 'numeric', minute: '2-digit' };
  if (timeZone) {
    options.timeZone = normalizeTimeZone(timeZone);
  }
  return date.toLocaleTimeString([], options);
}

function formatCalendarTimeRangeLabel(startDate, endDate, timeZone = null) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return '';
  const startLabel = formatCalendarTimeLabel(startDate, timeZone);
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return startLabel;
  return `${startLabel} - ${formatCalendarTimeLabel(endDate, timeZone)}`;
}

function hexColorToRgba(hex, alpha) {
  const normalized = normalizeScheduleEventColor(hex);
  const opacity = Number(alpha);
  if (!normalized || !Number.isFinite(opacity)) return null;
  const channelHex = normalized.slice(1);
  const r = Number.parseInt(channelHex.slice(0, 2), 16);
  const g = Number.parseInt(channelHex.slice(2, 4), 16);
  const b = Number.parseInt(channelHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

function applyScheduleCalendarAccent(element, color) {
  if (!(element instanceof HTMLElement)) return;
  const normalizedColor = normalizeScheduleEventColor(color) ?? SCHEDULE_CALENDAR_COLOR_PALETTE[0];
  const borderColor = hexColorToRgba(normalizedColor, 0.6);
  const backgroundColor = hexColorToRgba(normalizedColor, 0.2);
  element.style.boxShadow = `inset 3px 0 0 ${normalizedColor}`;
  if (borderColor) element.style.borderColor = borderColor;
  if (backgroundColor) element.style.backgroundColor = backgroundColor;
}

function renderSchedulingPage() {
  if (!schedulingCalendar) return;
  schedulingCalendar.innerHTML = '';
  if (!state.workspace) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Select a workspace to view scheduling.';
    schedulingCalendar.appendChild(note);
    return;
  }

  const mobileViewport = isMobileViewport();
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const panelHeader = schedulingPage?.querySelector('.panel-header') ?? null;
  if (panelHeader && schedulingAddBtn && !mobileViewport && schedulingAddBtn.parentElement !== panelHeader) {
    schedulingAddBtn.classList.remove('scheduling-mobile-add-btn');
    panelHeader.appendChild(schedulingAddBtn);
  }
  const rangeMode = getSchedulingCalendarRange();
  const weekMode = getSchedulingWeekMode();
  const monthDate = getSchedulingCalendarMonth();
  const dayDate = getSchedulingCalendarDay();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();
  const startOffset = firstDay.getDay();
  const weekStart = getSchedulingCalendarWeekStart();
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const visibleWeekDates = (() => {
    if (weekMode === 'workweek') {
      const monday = new Date(weekStart.getTime());
      monday.setDate(monday.getDate() + 1);
      return Array.from({ length: 5 }, (_, index) => {
        const date = new Date(monday.getTime());
        date.setDate(monday.getDate() + index);
        date.setHours(12, 0, 0, 0);
        return date;
      });
    }
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart.getTime());
      date.setDate(weekStart.getDate() + index);
      date.setHours(12, 0, 0, 0);
      return date;
    });
  })();
  const timeGridDates = rangeMode === 'day'
    ? [new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 12, 0, 0, 0)]
    : visibleWeekDates;
  const weekDisplayStart = timeGridDates[0] ?? weekStart;
  const weekDisplayEnd = timeGridDates[timeGridDates.length - 1] ?? weekEnd;
  const visibleDateKeys = rangeMode === 'week' || rangeMode === 'day'
    ? timeGridDates.map((date) => formatDateOnlyValue(date))
    : Array.from({ length: totalDays }, (_, index) => formatDateOnlyValue(new Date(year, month, index + 1, 12, 0, 0, 0)));
  const visibleDateKeySet = new Set(visibleDateKeys);
  const rangeStartKey = visibleDateKeys[0] ?? formatDateOnlyValue(new Date());
  const rangeEndKey = visibleDateKeys[visibleDateKeys.length - 1] ?? rangeStartKey;
  const rangeStart = getUtcDateForTimeZoneParts(
    Number(rangeStartKey.slice(0, 4)),
    Number(rangeStartKey.slice(5, 7)),
    Number(rangeStartKey.slice(8, 10)),
    0,
    0,
    displayTimeZone
  );
  const rangeEndStart = getUtcDateForTimeZoneParts(
    Number(rangeEndKey.slice(0, 4)),
    Number(rangeEndKey.slice(5, 7)),
    Number(rangeEndKey.slice(8, 10)),
    0,
    0,
    displayTimeZone
  );
  const rangeEnd = new Date(rangeEndStart.getTime() + (24 * 60 * 60 * 1000) - 1);

  const header = document.createElement('div');
  header.className = 'calendar-header';
  header.classList.add('scheduling-calendar-header');
  if (mobileViewport) {
    header.classList.add('is-mobile');
  }
  const navControls = document.createElement('div');
  navControls.className = 'calendar-nav-controls';
  const title = document.createElement('div');
  title.className = 'calendar-title';
  if (rangeMode === 'week') {
    const rangeLabel = `${formatDateInTimeZone(weekDisplayStart, { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)} - ${formatDateInTimeZone(new Date(weekDisplayEnd), { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)}`;
    const sameMonth = formatDateInTimeZone(
      weekDisplayStart,
      { month: 'numeric', year: 'numeric' },
      displayTimeZone
    ) === formatDateInTimeZone(
      weekDisplayEnd,
      { month: 'numeric', year: 'numeric' },
      displayTimeZone
    );
    title.textContent = mobileViewport && sameMonth
      ? formatDateInTimeZone(weekDisplayStart, { month: 'long', year: 'numeric' }, displayTimeZone)
      : rangeLabel;
  } else if (rangeMode === 'day') {
    title.textContent = formatDateInTimeZone(
      dayDate,
      mobileViewport
        ? { month: 'long', day: 'numeric', year: 'numeric' }
        : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      displayTimeZone
    );
  } else {
    title.textContent = formatDateInTimeZone(firstDay, { month: 'long', year: 'numeric' }, displayTimeZone);
  }
  const controls = document.createElement('div');
  controls.className = 'calendar-controls';
  const rangeSelect = document.createElement('select');
  rangeSelect.className = 'calendar-range-select';
  rangeSelect.innerHTML = `
    <option value="month">Month</option>
    <option value="week">Week</option>
    <option value="day">Day</option>
  `;
  rangeSelect.value = rangeMode;
  rangeSelect.addEventListener('change', () => {
    const nextRange = rangeSelect.value;
    const anchor = rangeMode === 'day'
      ? dayDate
      : rangeMode === 'week'
        ? weekDisplayStart
        : new Date(year, month, 1, 12, 0, 0, 0);
    setSchedulingCalendarRange(nextRange);
    if (nextRange === 'week') {
      setSchedulingCalendarWeekStart(anchor);
    } else if (nextRange === 'day') {
      setSchedulingCalendarDay(anchor);
    } else {
      setSchedulingCalendarMonth(anchor);
    }
    render();
  });
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'icon-button';
  prevBtn.textContent = '‹';
  prevBtn.title = rangeMode === 'day'
    ? 'Previous day'
    : rangeMode === 'week'
      ? 'Previous week'
      : 'Previous month';
  prevBtn.addEventListener('click', () => {
    if (rangeMode === 'day') {
      const prevDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() - 1, 12, 0, 0, 0);
      setSchedulingCalendarDay(prevDay);
    } else if (rangeMode === 'week') {
      const prevWeek = new Date(weekStart.getTime());
      prevWeek.setDate(prevWeek.getDate() - 7);
      setSchedulingCalendarWeekStart(prevWeek);
    } else {
      const prev = new Date(year, month - 1, 1);
      setSchedulingCalendarMonth(prev);
    }
    render();
  });
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'icon-button';
  nextBtn.textContent = '›';
  nextBtn.title = rangeMode === 'day'
    ? 'Next day'
    : rangeMode === 'week'
      ? 'Next week'
      : 'Next month';
  nextBtn.addEventListener('click', () => {
    if (rangeMode === 'day') {
      const nextDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1, 12, 0, 0, 0);
      setSchedulingCalendarDay(nextDay);
    } else if (rangeMode === 'week') {
      const nextWeek = new Date(weekStart.getTime());
      nextWeek.setDate(nextWeek.getDate() + 7);
      setSchedulingCalendarWeekStart(nextWeek);
    } else {
      const next = new Date(year, month + 1, 1);
      setSchedulingCalendarMonth(next);
    }
    render();
  });
  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'subtle-button calendar-today-button';
  todayBtn.textContent = 'Today';
  todayBtn.title = 'Jump to today';
  todayBtn.addEventListener('click', () => {
    const today = new Date();
    setSchedulingCalendarMonth(today);
    if (rangeMode === 'day') {
      setSchedulingCalendarDay(today);
    } else if (rangeMode === 'week') {
      setSchedulingCalendarWeekStart(today);
    }
    render();
  });
  const monthJumpInput = document.createElement('input');
  monthJumpInput.type = 'month';
  monthJumpInput.className = 'calendar-jump-input';
  monthJumpInput.title = 'Jump to month';
  monthJumpInput.value = state.ui?.schedulingCalendarMonth ?? `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}`;
  monthJumpInput.addEventListener('change', () => {
    const monthValue = parseMonthValue(monthJumpInput.value);
    if (!monthValue) return;
    setSchedulingCalendarMonth(monthValue);
    if (rangeMode === 'day') {
      setSchedulingCalendarDay(monthValue);
    } else if (rangeMode === 'week') {
      setSchedulingCalendarWeekStart(monthValue);
    }
    render();
  });
  const dateJumpInput = document.createElement('input');
  dateJumpInput.type = 'date';
  dateJumpInput.className = 'calendar-jump-input';
  dateJumpInput.title = 'Jump to specific date';
  dateJumpInput.value = rangeMode === 'day'
    ? (visibleDateKeys[0] ?? formatDateOnlyValue(dayDate))
    : rangeMode === 'week'
      ? (visibleDateKeys[0] ?? formatDateOnlyValue(weekDisplayStart))
      : formatDateOnlyValue(firstDay);
  dateJumpInput.addEventListener('change', () => {
    const dateValue = parseDateOnlyValue(dateJumpInput.value);
    if (!dateValue) return;
    setSchedulingCalendarMonth(dateValue);
    if (rangeMode === 'day') {
      setSchedulingCalendarDay(dateValue);
    } else if (rangeMode === 'week') {
      setSchedulingCalendarWeekStart(dateValue);
    }
    render();
  });
  navControls.appendChild(prevBtn);
  navControls.appendChild(nextBtn);
  navControls.appendChild(todayBtn);
  if (!mobileViewport) {
    navControls.appendChild(monthJumpInput);
    navControls.appendChild(dateJumpInput);
  }
  controls.appendChild(rangeSelect);
  if (mobileViewport) {
    const titleRow = document.createElement('div');
    titleRow.className = 'scheduling-mobile-title-row';
    titleRow.appendChild(title);
    if (schedulingAddBtn) {
      schedulingAddBtn.classList.add('scheduling-mobile-add-btn');
      titleRow.appendChild(schedulingAddBtn);
    }
    header.appendChild(titleRow);
    header.appendChild(navControls);
    header.appendChild(controls);
  } else {
    header.appendChild(navControls);
    header.appendChild(title);
    header.appendChild(controls);
  }
  schedulingCalendar.appendChild(header);

  const allDayByDate = new Map();
  const timedByDate = new Map();
  const pushAllDayEntry = (key, entry) => {
    const list = allDayByDate.get(key) ?? [];
    list.push(entry);
    allDayByDate.set(key, list);
  };
  const pushTimedEntry = (key, entry) => {
    const list = timedByDate.get(key) ?? [];
    list.push(entry);
    timedByDate.set(key, list);
  };
  const scheduleCalendarById = new Map(
    getScheduleCalendarsForWorkspace({ includeArchived: false })
      .map((calendar) => [calendar.id, calendar])
  );
  const visibleScheduleEvents = getScheduleEventsForWorkspace()
    .filter(event => isSchedulingKindVisible(event.kind));
  const scheduleEventById = new Map(visibleScheduleEvents.map((event) => [event.id, event]));
  visibleScheduleEvents.forEach((event) => {
    const calendar = scheduleCalendarById.get(resolveScheduleCalendarId(event.calendar_id));
    const calendarId = calendar?.id ?? null;
    const resolvedColor = getResolvedScheduleEventColor(event, calendar?.color ?? null);
    const startDate = event?.start_at ? new Date(event.start_at) : null;
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return;
    const endDate = event?.end_at ? new Date(event.end_at) : new Date(startDate);
    if (Number.isNaN(endDate.getTime())) return;
    const isAllDay = Number(event.all_day) === 1 || normalizeScheduleEventKind(event.kind) === 'day-off';
    const occurrences = getScheduleEventOccurrencesInRange(event, rangeStart, rangeEnd);
    occurrences.forEach(({ start: occurrenceStart, end: occurrenceEnd }) => {
      const startKey = getDateKeyInTimeZone(occurrenceStart, displayTimeZone);
      const endKey = isAllDay
        ? getDateKeyInTimeZone(occurrenceEnd, displayTimeZone)
        : getTimedEventEndDateKey(occurrenceEnd, occurrenceStart, displayTimeZone);
      const keys = listDateKeysBetween(startKey, endKey);
      keys.forEach((key) => {
        if (!key || !visibleDateKeySet.has(key)) return;
        if (isAllDay) {
          pushAllDayEntry(key, {
            type: 'schedule',
            id: event.id,
            calendar_id: calendarId,
            event_color: resolvedColor,
            kind: event.kind,
            title: event.title,
            all_day: true
          });
          return;
        }
        const yearValue = Number(key.slice(0, 4));
        const monthValue = Number(key.slice(5, 7));
        const dayValue = Number(key.slice(8, 10));
        const dayStart = getUtcDateForTimeZoneParts(yearValue, monthValue, dayValue, 0, 0, displayTimeZone);
        const dayEnd = new Date(dayStart.getTime() + (24 * 60 * 60 * 1000) - 1);
        const segmentStart = new Date(Math.max(occurrenceStart.getTime(), dayStart.getTime()));
        const segmentEnd = new Date(Math.min(occurrenceEnd.getTime(), dayEnd.getTime()));
        if (segmentEnd.getTime() <= segmentStart.getTime()) {
          segmentEnd.setTime(segmentStart.getTime() + (30 * 60 * 1000));
        }
        const startMin = getMinutesInDayInTimeZone(segmentStart, displayTimeZone);
        let endMin = getMinutesInDayInTimeZone(segmentEnd, displayTimeZone);
        if (endMin <= startMin) {
          endMin = Math.min(24 * 60, startMin + 30);
        }
        pushTimedEntry(key, {
          type: 'schedule',
          id: event.id,
          calendar_id: calendarId,
          event_color: resolvedColor,
          kind: event.kind,
          title: event.title,
          all_day: false,
          start: segmentStart,
          end: segmentEnd,
          startMin,
          endMin
        });
      });
    });
  });

  if (getSchedulingShowTasks()) {
    const completedVisibility = getTaskCompletedVisibility();
    const futureVisibilityDays = getTaskFutureVisibilityDays();
    Object.values(state.tasks ?? {}).forEach((task) => {
      if (task.workspace_id !== state.workspace?.id) return;
      if (isTaskCompletedAndHidden(task, completedVisibility)) return;
      if (isTaskBeyondDueHorizon(task, futureVisibilityDays)) return;
      if (!task.due_at) return;
      const due = new Date(task.due_at);
      if (Number.isNaN(due.getTime())) return;
      const dueTime = due.getTime();
      if (dueTime < rangeStart.getTime() || dueTime > rangeEnd.getTime()) return;
      const key = getDateKeyInTimeZone(due, displayTimeZone);
      if (!key || !visibleDateKeySet.has(key)) return;
      pushAllDayEntry(key, {
        type: 'task',
        id: task.id,
        title: task.title,
        all_day: true,
        due: due
      });
    });
  }

  if (getCalendarIncludeHolidays()) {
    const holidays = getHolidayEntriesInRange(rangeStart, rangeEnd);
    holidays.forEach((holiday) => {
      const key = getDateKeyInTimeZone(holiday.date, displayTimeZone);
      if (!key) return;
      pushAllDayEntry(key, {
        type: 'holiday',
        id: holiday.id,
        title: holiday.title,
        all_day: true
      });
    });
  }

  if (rangeMode === 'week' || rangeMode === 'day') {
    const todayKey = getDateKeyInTimeZone(new Date(), displayTimeZone);
    const isMobileWeek = mobileViewport;
    const hourHeight = isMobileWeek ? 58 : 84;
    const openCreateFromTimeSlot = (dateKey, offsetY, columnHeight) => {
      if (columnHeight <= 0) return;
      const minuteStep = 30;
      const minutesInDay = 24 * 60;
      const ratio = Math.max(0, Math.min(1, offsetY / columnHeight));
      const nearestMinutes = Math.round((ratio * minutesInDay) / minuteStep) * minuteStep;
      const clampedMinutes = Math.max(0, Math.min((minutesInDay - minuteStep), nearestMinutes));
      const start = getUtcDateForTimeZoneParts(
        Number(dateKey.slice(0, 4)),
        Number(dateKey.slice(5, 7)),
        Number(dateKey.slice(8, 10)),
        Math.floor(clampedMinutes / 60),
        clampedMinutes % 60,
        displayTimeZone
      );
      const durationMinutes = getSchedulingDefaultEventDurationMinutes();
      const end = new Date(start.getTime() + (durationMinutes * 60 * 1000));
      openScheduleEventModal(null, {
        title: '',
        kind: 'event',
        all_day: false,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        notes: ''
      });
    };
    const weekWrap = document.createElement('div');
    weekWrap.className = 'scheduling-week-wrap';
    if (isMobileWeek) {
      weekWrap.classList.add('is-mobile');
    }
    const weekHeader = document.createElement('div');
    weekHeader.className = 'scheduling-week-header';
    weekHeader.style.setProperty('--week-day-count', String(timeGridDates.length));
    const corner = document.createElement('div');
    corner.className = 'scheduling-week-corner';
    weekHeader.appendChild(corner);
    timeGridDates.forEach((date, index) => {
      const dayCell = document.createElement('div');
      dayCell.className = 'scheduling-week-day-header';
      const key = visibleDateKeys[index] ?? formatDateOnlyValue(date);
      if (key === todayKey) dayCell.classList.add('is-today');
      if (rangeMode === 'week') {
        dayCell.classList.add('is-day-switch');
        dayCell.tabIndex = 0;
        dayCell.setAttribute('role', 'button');
        dayCell.setAttribute('aria-label', `Open day view for ${formatDateInTimeZone(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, displayTimeZone)}`);
      }
      if (isMobileWeek) {
        const dayName = document.createElement('span');
        dayName.className = 'scheduling-week-day-name';
        dayName.textContent = formatDateInTimeZone(date, { weekday: 'short' }, displayTimeZone);
        const dayDate = document.createElement('span');
        dayDate.className = 'scheduling-week-day-date';
        dayDate.textContent = String(Number(key.slice(8, 10)));
        dayCell.appendChild(dayName);
        dayCell.appendChild(dayDate);
      } else {
        dayCell.textContent = formatDateInTimeZone(date, { weekday: 'short', month: 'short', day: 'numeric' }, displayTimeZone);
      }
      if (rangeMode === 'week') {
        const openDayView = () => {
          const selectedDate = parseDateOnlyValue(key) ?? new Date(date.getTime());
          setSchedulingCalendarDay(selectedDate);
          setSchedulingCalendarRange('day');
          render();
        };
        dayCell.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openDayView();
        });
        dayCell.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          openDayView();
        });
      }
      weekHeader.appendChild(dayCell);
    });
    weekWrap.appendChild(weekHeader);

    const allDayRow = document.createElement('div');
    allDayRow.className = 'scheduling-week-all-day-row';
    allDayRow.style.setProperty('--week-day-count', String(timeGridDates.length));
    const allDayCellByKey = new Map();
    const allDayLabel = document.createElement('div');
    allDayLabel.className = 'scheduling-week-all-day-label';
    allDayLabel.textContent = 'All day';
    allDayRow.appendChild(allDayLabel);
    timeGridDates.forEach((date, index) => {
      const dayCell = document.createElement('div');
      dayCell.className = 'scheduling-week-all-day-cell';
      const key = visibleDateKeys[index] ?? formatDateOnlyValue(date);
      dayCell.dataset.dateKey = key;
      allDayCellByKey.set(key, dayCell);
      const entries = allDayByDate.get(key) ?? [];
      entries.slice(0, 4).forEach((entry) => {
        const chip = document.createElement('div');
        if (entry.type === 'schedule') {
          chip.className = `calendar-item schedule-${toCssToken(entry.kind ?? 'event')}`;
          applyScheduleCalendarAccent(chip, entry.event_color);
        } else {
          chip.className = `calendar-item ${entry.type}`;
        }
        chip.textContent = entry.title;
        if (entry.type === 'schedule') {
          chip.classList.add('is-day-draggable');
          let dragPointerId = null;
          let dragStartX = 0;
          let dragStartY = 0;
          let dragMoved = false;
          let dragTargetKey = key;
          let suppressClickOnce = false;
          const clearDropTargets = () => {
            allDayCellByKey.forEach((cell) => {
              cell.classList.remove('is-drop-target');
            });
          };
          const setDropTarget = (targetKey) => {
            const nextKey = String(targetKey ?? '').trim() || key;
            dragTargetKey = nextKey;
            clearDropTargets();
            if (nextKey === key) return;
            allDayCellByKey.get(nextKey)?.classList.add('is-drop-target');
          };
          const finalizeDrag = (commit) => {
            if (dragPointerId !== null && chip.hasPointerCapture(dragPointerId)) {
              chip.releasePointerCapture(dragPointerId);
            }
            dragPointerId = null;
            chip.classList.remove('is-day-dragging');
            clearDropTargets();
            if (!dragMoved || !commit || !dragTargetKey || dragTargetKey === key) return;
            const current = scheduleEventById.get(entry.id);
            if (!current?.start_at) return;
            const startAt = new Date(current.start_at);
            if (Number.isNaN(startAt.getTime())) return;
            const endAt = current.end_at ? new Date(current.end_at) : new Date(startAt.getTime());
            if (Number.isNaN(endAt.getTime())) return;
            const dayDelta = getDayDeltaBetweenDateKeys(key, dragTargetKey);
            if (!dayDelta) return;
            const nextStart = new Date(startAt.getTime());
            nextStart.setDate(nextStart.getDate() + dayDelta);
            const nextEnd = new Date(endAt.getTime());
            nextEnd.setDate(nextEnd.getDate() + dayDelta);
            updateScheduleEventRecord(entry.id, {
              start_at: nextStart.toISOString(),
              end_at: nextEnd.toISOString()
            });
            render();
          };
          chip.addEventListener('pointerdown', (pointerEvent) => {
            if (pointerEvent.button !== 0) return;
            if (pointerEvent.pointerType === 'touch') return;
            dragPointerId = pointerEvent.pointerId;
            dragStartX = pointerEvent.clientX;
            dragStartY = pointerEvent.clientY;
            dragMoved = false;
            dragTargetKey = key;
            suppressClickOnce = false;
            chip.setPointerCapture(pointerEvent.pointerId);
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
          });
          chip.addEventListener('pointermove', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            const deltaX = Math.abs(pointerEvent.clientX - dragStartX);
            const deltaY = Math.abs(pointerEvent.clientY - dragStartY);
            if (!dragMoved && deltaX < 6 && deltaY < 6) return;
            dragMoved = true;
            suppressClickOnce = true;
            chip.classList.add('is-day-dragging');
            const targetElement = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
            const targetCell = targetElement instanceof Element
              ? targetElement.closest('.scheduling-week-all-day-cell')
              : null;
            const targetKey = targetCell instanceof HTMLElement
              ? String(targetCell.dataset.dateKey ?? '').trim()
              : '';
            setDropTarget(targetKey || key);
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
          });
          chip.addEventListener('pointerup', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            suppressClickOnce = true;
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
            if (!dragMoved) {
              const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
              if (current) openScheduleEventModal(current);
            }
            finalizeDrag(true);
          });
          chip.addEventListener('pointercancel', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
            finalizeDrag(false);
          });
          chip.addEventListener('click', (event) => {
            if (suppressClickOnce) {
              suppressClickOnce = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
            if (current) openScheduleEventModal(current);
          });
          chip.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
            if (!current) return;
            showScheduleEventContextMenu(current, event.clientX, event.clientY);
          });
        } else if (entry.type === 'task') {
          chip.addEventListener('click', () => openTaskEditor(entry.id));
        }
        dayCell.appendChild(chip);
      });
      if (entries.length > 4) {
        const more = document.createElement('div');
        more.className = 'calendar-more';
        more.textContent = `+${entries.length - 4} more`;
        dayCell.appendChild(more);
      }
      dayCell.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.calendar-item')) return;
        event.preventDefault();
        event.stopPropagation();
        showSchedulePasteContextMenu(event.clientX, event.clientY, { dateKey: key });
      });
      allDayRow.appendChild(dayCell);
    });
    weekWrap.appendChild(allDayRow);

    const body = document.createElement('div');
    body.className = 'scheduling-week-body';
    if (isMobileWeek) {
      body.classList.add('is-mobile');
    }
    body.style.setProperty('--week-day-count', String(timeGridDates.length));
    body.style.setProperty('--hour-height', `${hourHeight}px`);
    const gutter = document.createElement('div');
    gutter.className = 'scheduling-week-time-gutter';
    for (let hour = 0; hour < 24; hour += 1) {
      const label = document.createElement('div');
      label.className = 'scheduling-week-time-label';
      label.style.top = `${hour * hourHeight}px`;
      label.textContent = formatCalendarHourLabel(hour);
      gutter.appendChild(label);
    }
    body.appendChild(gutter);
    const days = document.createElement('div');
    days.className = 'scheduling-week-days';
    const dayColumnByKey = new Map();
    timeGridDates.forEach((date, index) => {
      const key = visibleDateKeys[index] ?? formatDateOnlyValue(date);
      const column = document.createElement('div');
      column.className = 'scheduling-week-day-column';
      column.dataset.dateKey = key;
      dayColumnByKey.set(key, column);
      column.title = 'Click to create event';
      for (let hour = 1; hour < 24; hour += 1) {
        const line = document.createElement('div');
        line.className = 'scheduling-week-hour-line';
        line.style.top = `${hour * hourHeight}px`;
        column.appendChild(line);
      }
      const timedEntries = (timedByDate.get(key) ?? [])
        .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

      const laneEnds = [];
      timedEntries.forEach((entry) => {
        let lane = laneEnds.findIndex((laneEnd) => entry.startMin >= laneEnd);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = entry.endMin;
        entry.lane = lane;
      });
      const laneCount = Math.max(1, laneEnds.length);
      timedEntries.forEach((entry) => {
        const block = document.createElement('button');
        block.type = 'button';
        block.className = `scheduling-week-event schedule-${toCssToken(entry.kind ?? 'event')}`;
        const sourceEvent = scheduleEventById.get(entry.id) ?? null;
        const sourceStart = sourceEvent?.start_at ? new Date(sourceEvent.start_at) : null;
        const sourceEnd = sourceEvent?.end_at ? new Date(sourceEvent.end_at) : null;
        const sourceHasValidTime = sourceStart instanceof Date
          && sourceEnd instanceof Date
          && !Number.isNaN(sourceStart.getTime())
          && !Number.isNaN(sourceEnd.getTime());
        const sourceDurationMinutes = sourceHasValidTime
          ? Math.max(15, Math.round((sourceEnd.getTime() - sourceStart.getTime()) / (60 * 1000)))
          : 0;
        const sourceStartKey = sourceHasValidTime
          ? getDateKeyInTimeZone(sourceStart, displayTimeZone)
          : '';
        const sourceEndKey = sourceHasValidTime
          ? getTimedEventEndDateKey(sourceEnd, sourceStart, displayTimeZone)
          : '';
        const isSameDayTimedEvent = sourceHasValidTime
          && Number(sourceEvent?.all_day ?? 0) !== 1
          && normalizeScheduleEventKind(sourceEvent?.kind) !== 'day-off'
          && sourceStartKey === key
          && sourceEndKey === key;
        const enableVerticalDrag = isSameDayTimedEvent && sourceDurationMinutes < (24 * 60);
        const top = (entry.startMin / 60) * hourHeight;
        const height = Math.max(28, ((entry.endMin - entry.startMin) / 60) * hourHeight);
        block.style.top = `${top}px`;
        block.style.height = `${height}px`;
        block.style.left = `calc(${(entry.lane / laneCount) * 100}% + 2px)`;
        block.style.width = `calc(${(100 / laneCount)}% - 4px)`;
        const titleEl = document.createElement('div');
        titleEl.className = 'scheduling-week-event-title';
        titleEl.textContent = entry.title;
        const metaEl = document.createElement('div');
        metaEl.className = 'scheduling-week-event-meta';
        metaEl.textContent = formatCalendarTimeRangeLabel(entry.start, entry.end, displayTimeZone);
        block.appendChild(titleEl);
        block.appendChild(metaEl);
        applyScheduleCalendarAccent(block, entry.event_color);
        if (enableVerticalDrag) {
          block.classList.add('is-time-draggable');
        }
        let suppressClickOnce = false;
        const originalLeft = block.style.left;
        const originalWidth = block.style.width;
        const previewRangeLabel = (previewStart, previewEnd, previewDayKey) => {
          if (previewDayKey === key) {
            return formatCalendarTimeRangeLabel(previewStart, previewEnd, displayTimeZone);
          }
          return `${formatDateInTimeZone(previewStart, { weekday: 'short', month: 'short', day: 'numeric' }, displayTimeZone)} · ${formatCalendarTimeRangeLabel(previewStart, previewEnd, displayTimeZone)}`;
        };
        if (enableVerticalDrag) {
          const minuteStep = 15;
          const maxStartMinutes = Math.max(0, (24 * 60) - sourceDurationMinutes);
          const autoScrollEdgePx = 40;
          const autoScrollMaxSpeed = 24;
          let dragPointerId = null;
          let dragOriginClientX = 0;
          let dragOriginClientY = 0;
          let dragOriginScrollTop = 0;
          let dragPreviewStartMinutes = entry.startMin;
          let dragPreviewDayKey = key;
          let dragMoved = false;
          let dragLatestClientX = 0;
          let dragLatestClientY = 0;
          let dragAutoScrollSpeed = 0;
          let dragAutoScrollFrame = null;

          const resetPreview = () => {
            if (block.parentElement !== column) {
              column.appendChild(block);
            }
            block.style.top = `${top}px`;
            block.style.left = originalLeft;
            block.style.width = originalWidth;
            metaEl.textContent = formatCalendarTimeRangeLabel(entry.start, entry.end, displayTimeZone);
          };

          const setPreview = (startMinutes, dayKey) => {
            const targetColumn = dayColumnByKey.get(dayKey) ?? column;
            if (block.parentElement !== targetColumn) {
              targetColumn.appendChild(block);
            }
            if (dayKey === key) {
              block.style.left = originalLeft;
              block.style.width = originalWidth;
            } else {
              block.style.left = '2px';
              block.style.width = 'calc(100% - 4px)';
            }
            block.style.top = `${(startMinutes / 60) * hourHeight}px`;
            const previewStart = getUtcDateForTimeZoneParts(
              Number(dayKey.slice(0, 4)),
              Number(dayKey.slice(5, 7)),
              Number(dayKey.slice(8, 10)),
              Math.floor(startMinutes / 60),
              startMinutes % 60,
              displayTimeZone
            );
            const previewEnd = new Date(previewStart.getTime() + (sourceDurationMinutes * 60 * 1000));
            metaEl.textContent = previewRangeLabel(previewStart, previewEnd, dayKey);
          };

          const stopAutoScroll = () => {
            dragAutoScrollSpeed = 0;
            if (dragAutoScrollFrame !== null) {
              cancelAnimationFrame(dragAutoScrollFrame);
              dragAutoScrollFrame = null;
            }
          };

          const updatePreviewFromPointer = (clientX, clientY) => {
            dragLatestClientX = clientX;
            dragLatestClientY = clientY;
            const targetElement = document.elementFromPoint(clientX, clientY);
            const hoveredColumn = targetElement instanceof Element
              ? targetElement.closest('.scheduling-week-day-column')
              : null;
            const nextDayKey = hoveredColumn instanceof HTMLElement
              ? String(hoveredColumn.dataset.dateKey ?? '').trim() || key
              : dragPreviewDayKey;
            const scrollDeltaY = body.scrollTop - dragOriginScrollTop;
            const effectiveDeltaY = (clientY - dragOriginClientY) + scrollDeltaY;
            const rawDeltaMinutes = (effectiveDeltaY / hourHeight) * 60;
            const snappedDeltaMinutes = Math.round(rawDeltaMinutes / minuteStep) * minuteStep;
            const nextStartMinutes = Math.max(
              0,
              Math.min(maxStartMinutes, entry.startMin + snappedDeltaMinutes)
            );
            const movedX = Math.abs(clientX - dragOriginClientX);
            const movedY = Math.abs(effectiveDeltaY);
            if (!dragMoved && (movedX >= 6 || movedY >= 6)) {
              dragMoved = true;
            }
            if (!dragMoved) return false;
            suppressClickOnce = true;
            if (nextStartMinutes === dragPreviewStartMinutes && nextDayKey === dragPreviewDayKey) {
              return false;
            }
            dragPreviewStartMinutes = nextStartMinutes;
            dragPreviewDayKey = nextDayKey;
            setPreview(nextStartMinutes, nextDayKey);
            return true;
          };

          const runAutoScroll = () => {
            dragAutoScrollFrame = null;
            if (dragPointerId === null || dragAutoScrollSpeed === 0) return;
            const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
            if (maxScrollTop <= 0) {
              stopAutoScroll();
              return;
            }
            const before = body.scrollTop;
            const next = Math.max(0, Math.min(maxScrollTop, before + dragAutoScrollSpeed));
            if (next !== before) {
              body.scrollTop = next;
              updatePreviewFromPointer(dragLatestClientX, dragLatestClientY);
            } else {
              stopAutoScroll();
              return;
            }
            if (dragPointerId !== null && dragAutoScrollSpeed !== 0) {
              dragAutoScrollFrame = requestAnimationFrame(runAutoScroll);
            }
          };

          const queueAutoScroll = () => {
            if (dragPointerId === null || dragAutoScrollSpeed === 0 || dragAutoScrollFrame !== null) return;
            dragAutoScrollFrame = requestAnimationFrame(runAutoScroll);
          };

          const updateAutoScrollSpeed = (clientY) => {
            const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
            if (maxScrollTop <= 0) {
              stopAutoScroll();
              return;
            }
            const bounds = body.getBoundingClientRect();
            let nextSpeed = 0;
            if (clientY >= bounds.bottom - autoScrollEdgePx) {
              const ratio = Math.min(1, (clientY - (bounds.bottom - autoScrollEdgePx)) / autoScrollEdgePx);
              nextSpeed = Math.max(4, Math.round(autoScrollMaxSpeed * ratio));
            } else if (clientY <= bounds.top + autoScrollEdgePx) {
              const ratio = Math.min(1, ((bounds.top + autoScrollEdgePx) - clientY) / autoScrollEdgePx);
              nextSpeed = -Math.max(4, Math.round(autoScrollMaxSpeed * ratio));
            }
            if (nextSpeed === 0) {
              stopAutoScroll();
              return;
            }
            dragAutoScrollSpeed = nextSpeed;
            queueAutoScroll();
          };

          const finalizeDrag = (commit) => {
            stopAutoScroll();
            if (dragPointerId !== null && block.hasPointerCapture(dragPointerId)) {
              block.releasePointerCapture(dragPointerId);
            }
            dragPointerId = null;
            block.classList.remove('is-time-dragging');
            if (
              !dragMoved
              || !commit
              || (
                dragPreviewStartMinutes === entry.startMin
                && dragPreviewDayKey === key
              )
            ) {
              resetPreview();
              return;
            }
            const nextStart = getUtcDateForTimeZoneParts(
              Number(dragPreviewDayKey.slice(0, 4)),
              Number(dragPreviewDayKey.slice(5, 7)),
              Number(dragPreviewDayKey.slice(8, 10)),
              Math.floor(dragPreviewStartMinutes / 60),
              dragPreviewStartMinutes % 60,
              displayTimeZone
            );
            const nextEnd = new Date(nextStart.getTime() + (sourceDurationMinutes * 60 * 1000));
            updateScheduleEventRecord(entry.id, {
              start_at: nextStart.toISOString(),
              end_at: nextEnd.toISOString()
            });
            render();
          };

          block.addEventListener('pointerdown', (pointerEvent) => {
            if (pointerEvent.button !== 0) return;
            if (pointerEvent.pointerType === 'touch') return;
            dragPointerId = pointerEvent.pointerId;
            dragOriginClientX = pointerEvent.clientX;
            dragOriginClientY = pointerEvent.clientY;
            dragOriginScrollTop = body.scrollTop;
            dragPreviewStartMinutes = entry.startMin;
            dragPreviewDayKey = key;
            dragMoved = false;
            dragLatestClientX = pointerEvent.clientX;
            dragLatestClientY = pointerEvent.clientY;
            suppressClickOnce = false;
            stopAutoScroll();
            block.classList.add('is-time-dragging');
            block.setPointerCapture(pointerEvent.pointerId);
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
          });

          block.addEventListener('pointermove', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            updateAutoScrollSpeed(pointerEvent.clientY);
            updatePreviewFromPointer(pointerEvent.clientX, pointerEvent.clientY);
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
          });

          block.addEventListener('pointerup', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            updatePreviewFromPointer(pointerEvent.clientX, pointerEvent.clientY);
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
            suppressClickOnce = true;
            if (!dragMoved) {
              const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
              if (current) openScheduleEventModal(current);
            }
            finalizeDrag(true);
          });

          block.addEventListener('pointercancel', (pointerEvent) => {
            if (dragPointerId !== pointerEvent.pointerId) return;
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
            finalizeDrag(false);
          });
        }
        block.addEventListener('click', (event) => {
          if (suppressClickOnce) {
            suppressClickOnce = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
          if (current) openScheduleEventModal(current);
        });
        block.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = (state.scheduleEvents ?? []).find(item => item.id === entry.id);
          if (!current) return;
          showScheduleEventContextMenu(current, event.clientX, event.clientY);
        });
        column.appendChild(block);
      });
      column.addEventListener('click', (clickEvent) => {
        if (!(clickEvent.target instanceof Element)) return;
        if (clickEvent.target.closest('.scheduling-week-event')) return;
        const bounds = column.getBoundingClientRect();
        if (!bounds.height) return;
        const offsetY = clickEvent.clientY - bounds.top;
        openCreateFromTimeSlot(key, offsetY, bounds.height);
      });
      column.addEventListener('contextmenu', (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('.scheduling-week-event')) return;
        const bounds = column.getBoundingClientRect();
        if (!bounds.height) return;
        const minuteStep = 15;
        const minutesInDay = 24 * 60;
        const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
        const nearestMinutes = Math.round((ratio * minutesInDay) / minuteStep) * minuteStep;
        const clampedMinutes = Math.max(0, Math.min((minutesInDay - minuteStep), nearestMinutes));
        event.preventDefault();
        event.stopPropagation();
        showSchedulePasteContextMenu(event.clientX, event.clientY, {
          dateKey: key,
          startMinutes: clampedMinutes
        });
      });
      days.appendChild(column);
    });
    body.appendChild(days);
    weekWrap.appendChild(body);
    schedulingCalendar.appendChild(weekWrap);
    const syncWeekScrollbarComp = () => {
      const scrollbarWidth = Math.max(0, body.offsetWidth - body.clientWidth);
      weekWrap.style.setProperty('--scheduling-week-scrollbar-width', `${scrollbarWidth}px`);
    };
    syncWeekScrollbarComp();
    requestAnimationFrame(syncWeekScrollbarComp);
    if (isMobileWeek) {
      const nowParts = getDateTimePartsInTimeZone(new Date(), displayTimeZone, { includeSeconds: false });
      const nowHour = Number.isFinite(nowParts?.hour) ? nowParts.hour : new Date().getHours();
      body.scrollTop = Math.max(0, (nowHour - 2) * hourHeight);
    }
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  weekdayLabels.forEach((label) => {
    const cell = document.createElement('div');
    cell.className = 'calendar-weekday';
    cell.textContent = label;
    grid.appendChild(cell);
  });

  for (let i = 0; i < startOffset; i += 1) {
    const empty = document.createElement('div');
    empty.className = 'calendar-day empty';
    grid.appendChild(empty);
  }

  const calendarDates = [];
  for (let day = 1; day <= totalDays; day += 1) {
    calendarDates.push(new Date(year, month, day));
  }
  const monthDayCellByKey = new Map();
  const clearMonthDropTargets = () => {
    monthDayCellByKey.forEach((cell) => {
      cell.classList.remove('is-drop-target');
    });
  };

  calendarDates.forEach((date) => {
    const key = visibleDateKeys[Math.max(0, date.getDate() - 1)] ?? formatDateOnlyValue(date);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.dataset.dateKey = key;
    monthDayCellByKey.set(key, cell);
    const dayLabel = document.createElement('div');
    dayLabel.className = 'calendar-day-number';
    dayLabel.textContent = String(date.getDate());
    cell.appendChild(dayLabel);
    const items = [
      ...(allDayByDate.get(key) ?? []),
      ...(timedByDate.get(key) ?? [])
    ];
    items.slice(0, 6).forEach((entry) => {
      const item = document.createElement('div');
      if (entry.type === 'schedule') {
        item.className = `calendar-item schedule-${toCssToken(entry.kind ?? 'event')}`;
        applyScheduleCalendarAccent(item, entry.event_color);
        if (!entry.all_day && entry.start instanceof Date && entry.end instanceof Date) {
          item.textContent = `${formatCalendarTimeLabel(entry.start, displayTimeZone)} · ${entry.title}`;
        } else {
          item.textContent = entry.title;
        }
      } else {
        item.className = `calendar-item ${entry.type}`;
        item.textContent = entry.title;
      }
      if (entry.type === 'schedule') {
        item.classList.add('is-day-draggable');
        let dragPointerId = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragMoved = false;
        let dragTargetKey = key;
        let suppressClickOnce = false;
        const finalizeDrag = (commit) => {
          if (dragPointerId !== null && item.hasPointerCapture(dragPointerId)) {
            item.releasePointerCapture(dragPointerId);
          }
          dragPointerId = null;
          item.classList.remove('is-day-dragging');
          clearMonthDropTargets();
          if (!dragMoved || !commit || !dragTargetKey || dragTargetKey === key) return;
          const current = scheduleEventById.get(entry.id);
          if (!current?.start_at) return;
          const startAt = new Date(current.start_at);
          if (Number.isNaN(startAt.getTime())) return;
          const endAt = current.end_at ? new Date(current.end_at) : new Date(startAt.getTime());
          if (Number.isNaN(endAt.getTime())) return;
          const dayDelta = getDayDeltaBetweenDateKeys(key, dragTargetKey);
          if (!dayDelta) return;
          const nextStart = new Date(startAt.getTime());
          nextStart.setDate(nextStart.getDate() + dayDelta);
          const nextEnd = new Date(endAt.getTime());
          nextEnd.setDate(nextEnd.getDate() + dayDelta);
          updateScheduleEventRecord(entry.id, {
            start_at: nextStart.toISOString(),
            end_at: nextEnd.toISOString()
          });
          render();
        };
        item.addEventListener('pointerdown', (pointerEvent) => {
          if (pointerEvent.button !== 0) return;
          if (pointerEvent.pointerType === 'touch') return;
          dragPointerId = pointerEvent.pointerId;
          dragStartX = pointerEvent.clientX;
          dragStartY = pointerEvent.clientY;
          dragMoved = false;
          dragTargetKey = key;
          suppressClickOnce = false;
          item.setPointerCapture(pointerEvent.pointerId);
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
        });
        item.addEventListener('pointermove', (pointerEvent) => {
          if (dragPointerId !== pointerEvent.pointerId) return;
          const deltaX = Math.abs(pointerEvent.clientX - dragStartX);
          const deltaY = Math.abs(pointerEvent.clientY - dragStartY);
          if (!dragMoved && deltaX < 6 && deltaY < 6) return;
          dragMoved = true;
          suppressClickOnce = true;
          item.classList.add('is-day-dragging');
          const targetElement = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
          const targetCell = targetElement instanceof Element
            ? targetElement.closest('.calendar-day[data-date-key]')
            : null;
          const targetKey = targetCell instanceof HTMLElement
            ? String(targetCell.dataset.dateKey ?? '').trim()
            : '';
          dragTargetKey = targetKey || key;
          clearMonthDropTargets();
          if (dragTargetKey !== key) {
            monthDayCellByKey.get(dragTargetKey)?.classList.add('is-drop-target');
          }
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
        });
        item.addEventListener('pointerup', (pointerEvent) => {
          if (dragPointerId !== pointerEvent.pointerId) return;
          suppressClickOnce = true;
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
          if (!dragMoved) {
            const current = (state.scheduleEvents ?? []).find(eventRecord => eventRecord.id === entry.id);
            if (current) openScheduleEventModal(current);
          }
          finalizeDrag(true);
        });
        item.addEventListener('pointercancel', (pointerEvent) => {
          if (dragPointerId !== pointerEvent.pointerId) return;
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
          finalizeDrag(false);
        });
        item.addEventListener('click', (event) => {
          if (suppressClickOnce) {
            suppressClickOnce = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const current = (state.scheduleEvents ?? []).find(eventRecord => eventRecord.id === entry.id);
          if (current) openScheduleEventModal(current);
        });
        item.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = (state.scheduleEvents ?? []).find(eventRecord => eventRecord.id === entry.id);
          if (!current) return;
          showScheduleEventContextMenu(current, event.clientX, event.clientY);
        });
      } else if (entry.type === 'task') {
        item.addEventListener('click', () => openTaskEditor(entry.id));
      }
      cell.appendChild(item);
    });
    if (items.length > 6) {
      const more = document.createElement('div');
      more.className = 'calendar-more';
      more.textContent = `+${items.length - 6} more`;
      cell.appendChild(more);
    }
    cell.addEventListener('contextmenu', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.calendar-item')) return;
      event.preventDefault();
      event.stopPropagation();
      showSchedulePasteContextMenu(event.clientX, event.clientY, { dateKey: key });
    });
    grid.appendChild(cell);
  });

  schedulingCalendar.appendChild(grid);
}

function renderCalendarView(tasks) {
  const completedVisibility = getTaskCompletedVisibility();
  const futureVisibilityDays = getTaskFutureVisibilityDays();
  const rangeMode = getCalendarRange();
  const mobileViewport = isMobileViewport();
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const todayKey = getDateKeyInTimeZone(new Date(), displayTimeZone);
  const monthDate = getCalendarMonth();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const weekStart = getCalendarWeekStart();
  const dayDate = getCalendarDay();
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const rangeStart = rangeMode === 'day'
    ? new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0, 0)
    : rangeMode === 'week'
      ? new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 0, 0, 0, 0)
      : new Date(year, month, 1, 0, 0, 0, 0);
  const rangeEnd = rangeMode === 'day'
    ? new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999)
    : rangeMode === 'week'
      ? weekEnd
      : new Date(year, month, totalDays, 23, 59, 59, 999);

  const header = document.createElement('div');
  header.className = 'calendar-header';
  header.classList.add('scheduling-calendar-header');
  if (mobileViewport) {
    header.classList.add('is-mobile');
  }
  const navControls = document.createElement('div');
  navControls.className = 'calendar-nav-controls';
  const title = document.createElement('div');
  title.className = 'calendar-title';
  title.textContent = rangeMode === 'day'
    ? formatDateInTimeZone(
      dayDate,
      mobileViewport
        ? { month: 'long', day: 'numeric', year: 'numeric' }
        : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      displayTimeZone
    )
    : rangeMode === 'week'
      ? `${formatDateInTimeZone(weekStart, { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)} - ${formatDateInTimeZone(new Date(weekEnd), { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)}`
      : formatDateInTimeZone(firstDay, { month: 'long', year: 'numeric' }, displayTimeZone);
  const controls = document.createElement('div');
  controls.className = 'calendar-controls';
  const rangeSelect = document.createElement('select');
  rangeSelect.className = 'calendar-range-select';
  rangeSelect.innerHTML = `
    <option value="month">Month</option>
    <option value="week">Week</option>
    <option value="day">Day</option>
  `;
  rangeSelect.value = rangeMode;
  rangeSelect.addEventListener('change', () => {
    const nextRange = rangeSelect.value;
    const anchor = rangeMode === 'day'
      ? dayDate
      : rangeMode === 'week'
        ? weekStart
        : new Date(year, month, 1, 12, 0, 0, 0);
    setCalendarRange(nextRange);
    if (nextRange === 'week') {
      setCalendarWeekStart(anchor);
    } else if (nextRange === 'day') {
      setCalendarDay(anchor);
    }
    render();
  });
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'icon-button';
  prevBtn.textContent = '‹';
  prevBtn.title = rangeMode === 'day'
    ? 'Previous day'
    : rangeMode === 'week'
      ? 'Previous week'
      : 'Previous month';
  prevBtn.addEventListener('click', () => {
    if (rangeMode === 'day') {
      const prevDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() - 1, 12, 0, 0, 0);
      setCalendarDay(prevDay);
    } else if (rangeMode === 'week') {
      const prevWeek = new Date(weekStart.getTime());
      prevWeek.setDate(prevWeek.getDate() - 7);
      setCalendarWeekStart(prevWeek);
    } else {
      const prev = new Date(year, month - 1, 1);
      setCalendarMonth(prev);
    }
    render();
  });
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'icon-button';
  nextBtn.textContent = '›';
  nextBtn.title = rangeMode === 'day'
    ? 'Next day'
    : rangeMode === 'week'
      ? 'Next week'
      : 'Next month';
  nextBtn.addEventListener('click', () => {
    if (rangeMode === 'day') {
      const nextDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1, 12, 0, 0, 0);
      setCalendarDay(nextDay);
    } else if (rangeMode === 'week') {
      const nextWeek = new Date(weekStart.getTime());
      nextWeek.setDate(nextWeek.getDate() + 7);
      setCalendarWeekStart(nextWeek);
    } else {
      const next = new Date(year, month + 1, 1);
      setCalendarMonth(next);
    }
    render();
  });
  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'subtle-button calendar-today-button';
  todayBtn.textContent = 'Today';
  todayBtn.title = 'Jump to today';
  todayBtn.addEventListener('click', () => {
    const today = new Date();
    setCalendarMonth(today);
    if (rangeMode === 'day') {
      setCalendarDay(today);
    } else if (rangeMode === 'week') {
      setCalendarWeekStart(today);
    }
    render();
  });
  const monthJumpInput = document.createElement('input');
  monthJumpInput.type = 'month';
  monthJumpInput.className = 'calendar-jump-input';
  monthJumpInput.title = 'Jump to month';
  monthJumpInput.value = state.ui?.calendarMonth ?? `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}`;
  monthJumpInput.addEventListener('change', () => {
    const monthValue = parseMonthValue(monthJumpInput.value);
    if (!monthValue) return;
    setCalendarMonth(monthValue);
    if (rangeMode === 'day') {
      setCalendarDay(monthValue);
    } else if (rangeMode === 'week') {
      setCalendarWeekStart(monthValue);
    }
    render();
  });
  const dateJumpInput = document.createElement('input');
  dateJumpInput.type = 'date';
  dateJumpInput.className = 'calendar-jump-input';
  dateJumpInput.title = 'Jump to specific date';
  dateJumpInput.value = rangeMode === 'day'
    ? (getDateKeyInTimeZone(dayDate, displayTimeZone) || formatDateOnlyValue(dayDate))
    : getDateKeyInTimeZone(rangeMode === 'week' ? weekStart : firstDay, displayTimeZone)
      || formatDateOnlyValue(rangeMode === 'week' ? weekStart : firstDay);
  dateJumpInput.addEventListener('change', () => {
    const dateValue = parseDateOnlyValue(dateJumpInput.value);
    if (!dateValue) return;
    setCalendarMonth(dateValue);
    if (rangeMode === 'day') {
      setCalendarDay(dateValue);
    } else if (rangeMode === 'week') {
      setCalendarWeekStart(dateValue);
    }
    render();
  });
  const includeLabel = document.createElement('label');
  includeLabel.className = 'inline calendar-toggle';
  const includeCheckbox = document.createElement('input');
  includeCheckbox.type = 'checkbox';
  includeCheckbox.checked = getCalendarIncludeNotices();
  includeCheckbox.addEventListener('change', () => {
    setCalendarIncludeNotices(includeCheckbox.checked);
    render();
  });
  const includeText = document.createElement('span');
  includeText.textContent = 'Show notices';
  includeLabel.appendChild(includeCheckbox);
  includeLabel.appendChild(includeText);
  navControls.appendChild(prevBtn);
  navControls.appendChild(nextBtn);
  navControls.appendChild(todayBtn);
  if (!mobileViewport) {
    navControls.appendChild(monthJumpInput);
    navControls.appendChild(dateJumpInput);
  }
  controls.appendChild(rangeSelect);
  controls.appendChild(includeLabel);
  header.appendChild(navControls);
  header.appendChild(title);
  header.appendChild(controls);
  taskTreeEl.appendChild(header);

  const entriesByDate = new Map();
  tasks.forEach(task => {
    if (isTaskCompletedAndHidden(task, completedVisibility)) return;
    if (isTaskBeyondDueHorizon(task, futureVisibilityDays)) return;
    if (!task.due_at) return;
    const due = new Date(task.due_at);
    if (Number.isNaN(due.getTime())) return;
    const key = getDateKeyInTimeZone(due, displayTimeZone);
    if (!key) return;
    const list = entriesByDate.get(key) ?? [];
    list.push({ type: 'task', id: task.id, title: task.title });
    entriesByDate.set(key, list);
  });

  if (getCalendarIncludeNotices()) {
    (state.notices ?? []).forEach(notice => {
      if (notice.dismissed_at) return;
      const occurrences = getNoticeOccurrencesInRange(notice, rangeStart, rangeEnd);
      occurrences.forEach((occurrenceDate) => {
        const key = getDateKeyInTimeZone(occurrenceDate, displayTimeZone);
        if (!key) return;
        const list = entriesByDate.get(key) ?? [];
        list.push({
          type: 'notice',
          id: notice.id,
          title: notice.title,
          noticeType: notice.notice_type ?? 'general'
        });
        entriesByDate.set(key, list);
      });
    });
  }

  if (rangeMode === 'week' || rangeMode === 'day') {
    const weekDates = rangeMode === 'day'
      ? [new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 12, 0, 0, 0)]
      : Array.from({ length: 7 }, (_, index) => {
        const date = new Date(weekStart.getTime());
        date.setDate(weekStart.getDate() + index);
        date.setHours(12, 0, 0, 0);
        return date;
      });
    const hourHeight = mobileViewport ? 58 : 84;

    const weekWrap = document.createElement('div');
    weekWrap.className = 'scheduling-week-wrap';
    if (mobileViewport) {
      weekWrap.classList.add('is-mobile');
    }

    const weekHeader = document.createElement('div');
    weekHeader.className = 'scheduling-week-header';
    weekHeader.style.setProperty('--week-day-count', String(weekDates.length));
    const corner = document.createElement('div');
    corner.className = 'scheduling-week-corner';
    weekHeader.appendChild(corner);
    weekDates.forEach((date) => {
      const dayHeader = document.createElement('div');
      dayHeader.className = 'scheduling-week-day-header';
      const key = getDateKeyInTimeZone(date, displayTimeZone) || formatDateOnlyValue(date);
      if (key === todayKey) dayHeader.classList.add('is-today');
      if (rangeMode === 'week') {
        dayHeader.classList.add('is-day-switch');
        dayHeader.tabIndex = 0;
        dayHeader.setAttribute('role', 'button');
        dayHeader.setAttribute(
          'aria-label',
          `Open day view for ${formatDateInTimeZone(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, displayTimeZone)}`
        );
      }
      if (mobileViewport) {
        const dayName = document.createElement('span');
        dayName.className = 'scheduling-week-day-name';
        dayName.textContent = formatDateInTimeZone(date, { weekday: 'short' }, displayTimeZone);
        const dayDateEl = document.createElement('span');
        dayDateEl.className = 'scheduling-week-day-date';
        dayDateEl.textContent = String(Number(key.slice(8, 10)));
        dayHeader.appendChild(dayName);
        dayHeader.appendChild(dayDateEl);
      } else {
        dayHeader.textContent = formatDateInTimeZone(date, { weekday: 'short', month: 'short', day: 'numeric' }, displayTimeZone);
      }
      if (rangeMode === 'week') {
        const openDayView = () => {
          const selectedDate = parseDateOnlyValue(key) ?? new Date(date.getTime());
          setCalendarDay(selectedDate);
          setCalendarRange('day');
          render();
        };
        dayHeader.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openDayView();
        });
        dayHeader.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          openDayView();
        });
      }
      weekHeader.appendChild(dayHeader);
    });
    weekWrap.appendChild(weekHeader);

    const allDayRow = document.createElement('div');
    allDayRow.className = 'scheduling-week-all-day-row';
    allDayRow.style.setProperty('--week-day-count', String(weekDates.length));
    const allDayLabel = document.createElement('div');
    allDayLabel.className = 'scheduling-week-all-day-label';
    allDayLabel.textContent = 'All day';
    allDayRow.appendChild(allDayLabel);
    weekDates.forEach((date) => {
      const key = getDateKeyInTimeZone(date, displayTimeZone) || formatDateOnlyValue(date);
      const dayCell = document.createElement('div');
      dayCell.className = 'scheduling-week-all-day-cell';
      const items = entriesByDate.get(key) ?? [];
      items.slice(0, 4).forEach((entry) => {
        const item = document.createElement('div');
        if (entry.type === 'notice') {
          item.className = `calendar-item notice notice-${toCssToken(entry.noticeType ?? 'general')}`;
        } else {
          item.className = `calendar-item ${entry.type}`;
        }
        item.textContent = entry.title;
        if (entry.type === 'task') {
          item.addEventListener('click', () => openTaskEditor(entry.id));
        } else if (entry.type === 'notice') {
          item.addEventListener('click', () => {
            const notice = (state.notices ?? []).find(r => r.id === entry.id);
            if (notice) openNoticeModalWithNotice(notice);
          });
        }
        dayCell.appendChild(item);
      });
      if (items.length > 4) {
        const more = document.createElement('div');
        more.className = 'calendar-more';
        more.textContent = `+${items.length - 4} more`;
        dayCell.appendChild(more);
      }
      allDayRow.appendChild(dayCell);
    });
    weekWrap.appendChild(allDayRow);

    const body = document.createElement('div');
    body.className = 'scheduling-week-body';
    body.style.setProperty('--week-day-count', String(weekDates.length));
    body.style.setProperty('--hour-height', `${hourHeight}px`);
    const timeGutter = document.createElement('div');
    timeGutter.className = 'scheduling-week-time-gutter';
    for (let hour = 0; hour < 24; hour += 1) {
      const label = document.createElement('div');
      label.className = 'scheduling-week-time-label';
      label.style.top = `${hour * hourHeight}px`;
      label.textContent = formatCalendarHourLabel(hour);
      timeGutter.appendChild(label);
    }
    body.appendChild(timeGutter);
    const days = document.createElement('div');
    days.className = 'scheduling-week-days';
    weekDates.forEach(() => {
      const column = document.createElement('div');
      column.className = 'scheduling-week-day-column';
      for (let hour = 1; hour < 24; hour += 1) {
        const line = document.createElement('div');
        line.className = 'scheduling-week-hour-line';
        line.style.top = `${hour * hourHeight}px`;
        column.appendChild(line);
      }
      days.appendChild(column);
    });
    body.appendChild(days);
    weekWrap.appendChild(body);
    taskTreeEl.appendChild(weekWrap);
    const syncWeekScrollbarComp = () => {
      const scrollbarWidth = Math.max(0, body.offsetWidth - body.clientWidth);
      weekWrap.style.setProperty('--scheduling-week-scrollbar-width', `${scrollbarWidth}px`);
    };
    syncWeekScrollbarComp();
    requestAnimationFrame(syncWeekScrollbarComp);
    if (mobileViewport) {
      const nowParts = getDateTimePartsInTimeZone(new Date(), displayTimeZone, { includeSeconds: false });
      const nowHour = Number.isFinite(nowParts?.hour) ? nowParts.hour : new Date().getHours();
      body.scrollTop = Math.max(0, (nowHour - 2) * hourHeight);
    }
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  weekdayLabels.forEach(label => {
    const cell = document.createElement('div');
    cell.className = 'calendar-weekday';
    cell.textContent = label;
    grid.appendChild(cell);
  });

  for (let i = 0; i < startOffset; i += 1) {
    const empty = document.createElement('div');
    empty.className = 'calendar-day empty';
    grid.appendChild(empty);
  }

  const calendarDates = [];
  for (let day = 1; day <= totalDays; day += 1) {
    calendarDates.push(new Date(year, month, day));
  }

  calendarDates.forEach((date) => {
    const key = getDateKeyInTimeZone(date, displayTimeZone) || formatDateOnlyValue(date);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (key === todayKey) {
      cell.classList.add('is-today');
    }
    cell.dataset.dateKey = key;
    const dayLabel = document.createElement('div');
    dayLabel.className = 'calendar-day-number';
    dayLabel.textContent = String(date.getDate());
    cell.appendChild(dayLabel);
    const items = entriesByDate.get(key) ?? [];
    items.slice(0, 4).forEach(entry => {
      const item = document.createElement('div');
      if (entry.type === 'notice') {
        item.className = `calendar-item notice notice-${toCssToken(entry.noticeType ?? 'general')}`;
      } else {
        item.className = `calendar-item ${entry.type}`;
      }
      item.textContent = entry.title;
      if (entry.type === 'task') {
        item.addEventListener('click', () => openTaskEditor(entry.id));
      } else if (entry.type === 'notice') {
        item.addEventListener('click', () => {
          const notice = (state.notices ?? []).find(r => r.id === entry.id);
          if (notice) openNoticeModalWithNotice(notice);
        });
      }
      cell.appendChild(item);
    });
    if (items.length > 4) {
      const more = document.createElement('div');
      more.className = 'calendar-more';
      more.textContent = `+${items.length - 4} more`;
      cell.appendChild(more);
    }
    cell.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.calendar-item') || target.closest('.calendar-more')) return;
      const selectedDate = parseDateOnlyValue(key) ?? new Date(date.getTime());
      setCalendarDay(selectedDate);
      setCalendarRange('day');
      render();
    });
    grid.appendChild(cell);
  });

  taskTreeEl.appendChild(grid);
}

function renderKanban(roots) {
  const inlineAddDisabled = isMobileViewport();
  const quickAddVisible = getTaskQuickAddVisible();
  const completedVisibility = getTaskCompletedVisibility();
  const futureVisibilityDays = getTaskFutureVisibilityDays();
  if ((inlineAddDisabled || !quickAddVisible) && state.ui?.kanbanQuickAdd) {
    setKanbanQuickAdd(null);
  }
  const grouped = new Map();
  roots.forEach(task => {
    if (isTaskCompletedAndHidden(task, completedVisibility)) return;
    if (isTaskBeyondDueHorizon(task, futureVisibilityDays)) return;
    const status = task.status ?? getDefaultStatusKey();
    if (!grouped.has(status)) grouped.set(status, []);
    grouped.get(status).push(task);
  });

  const board = document.createElement('div');
  board.className = 'kanban-board';

  const statuses = getStatusDefinitions();
  const visibleStatuses = statuses.filter(status => {
    const items = grouped.get(status.key) ?? [];
    return items.length > 0 || status.kanban_visible;
  });
  if (!visibleStatuses.length) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'No Kanban sections to show yet.';
    taskTreeEl.appendChild(note);
    return;
  }
  visibleStatuses.forEach(status => {
    const items = grouped.get(status.key) ?? [];
    const column = document.createElement('div');
    column.className = 'kanban-column status-section';
    column.style.setProperty('--status-color', getStatusColor(status.key));
    column.dataset.statusKey = status.key;

    const header = document.createElement('div');
    header.className = 'kanban-column-header';
    header.draggable = true;
    header.addEventListener('dragstart', (event) => beginColumnDrag(event, status.key, column));
    header.addEventListener('dragend', endColumnDrag);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'kanban-column-title';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const label = document.createElement('span');
    label.textContent = status.label;
    titleWrap.appendChild(dot);
    titleWrap.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'kanban-column-actions';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'icon-button kanban-add-button';
    addButton.title = `Add task to ${status.label}`;
    addButton.textContent = '＋';
    addButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setKanbanQuickAdd(status.key);
      render();
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'kanban-column-menu';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'icon-button menu-icon';
    menuButton.title = 'Section menu';
    menuButton.textContent = '☰';
    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'workspace-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextLabel = prompt('Section name', status.label);
      if (!nextLabel) return;
      const trimmed = nextLabel.trim();
      if (!trimmed || trimmed === status.label) return;
      await updateStatusRecord(status.id, { label: trimmed });
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete section';
    if (status.kind !== 'custom') {
      deleteItem.disabled = true;
      deleteItem.title = 'Default sections cannot be deleted';
    }
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (status.kind !== 'custom') {
        const confirmHide = confirm('Default sections cannot be deleted. Hide this section from Kanban?');
        if (confirmHide) {
          await updateStatusRecord(status.id, { kanban_visible: 0 });
          render();
        }
        menu.classList.add('hidden');
        openMenu = null;
        return;
      }
      await handleDeleteStatusColumn(status);
      menu.classList.add('hidden');
      openMenu = null;
    });

    menu.appendChild(renameItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    if (!inlineAddDisabled && quickAddVisible) {
      actions.appendChild(addButton);
    }
    actions.appendChild(menuWrapper);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'kanban-cards';
    attachKanbanDropzone(list, status.key);
    if (!inlineAddDisabled && quickAddVisible && state.ui?.kanbanQuickAdd === status.key) {
      const quickAdd = document.createElement('div');
      quickAdd.className = 'kanban-quick-add';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add task';
      quickAdd.appendChild(input);
      let submitted = false;
      input.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape') {
          setKanbanQuickAdd(null);
          render();
          return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        submitted = true;
        const projectId = getProjectIdFromTaskFilter();
        await createTaskRecord({ title, status: status.key, project_id: projectId });
        setKanbanQuickAdd(null);
        render();
      });
      input.addEventListener('blur', () => {
        if (submitted) return;
        setKanbanQuickAdd(null);
        render();
      });
      list.appendChild(quickAdd);
      setTimeout(() => {
        input.focus();
      }, 0);
    }
    items.forEach(node => list.appendChild(renderKanbanCard(node)));
    column.appendChild(list);
    board.appendChild(column);

    column.addEventListener('dragover', (event) => {
      if (!draggingColumnEl || draggingTaskId) return;
      event.preventDefault();
      if (column === draggingColumnEl) return;
      const rect = column.getBoundingClientRect();
      const insertAfter = event.clientX > rect.left + rect.width / 2;
      const parent = column.parentElement;
      if (!parent) return;
      parent.insertBefore(draggingColumnEl, insertAfter ? column.nextSibling : column);
      columnOrderDirty = true;
    });

    column.addEventListener('drop', (event) => {
      if (!draggingColumnEl || draggingTaskId) return;
      event.preventDefault();
    });
  });

  taskTreeEl.appendChild(board);
}

function renderKanbanCard(task) {
  const card = document.createElement('div');
  card.className = 'kanban-card' + (isDoneStatusKey(task.status) ? ' completed' : '');
  card.classList.toggle('is-selected', isTaskSelected(task.id));
  card.addEventListener('click', (event) => {
    if (suppressTaskClick) return;
    if (event.button !== 0) return;
    const selected = getSelectedTaskIds();
    if (!selected.length) return;
    event.preventDefault();
    if (!selected.includes(task.id)) {
      setSelectedTaskIds([...selected, task.id]);
    } else {
      setSelectedTaskIds(selected.filter(id => id !== task.id));
    }
  });
  card.addEventListener('dblclick', () => {
    if (suppressTaskClick) return;
    if (getSelectedTaskIds().length) return;
    openTaskEditor(task.id);
  });
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showTaskContextMenu(task.id, event.clientX, event.clientY);
  });
  attachKanbanDragHandlers(card, task);

  const title = document.createElement('div');
  title.className = 'kanban-card-title';
  title.textContent = task.title;

  const meta = document.createElement('div');
  meta.className = 'kanban-card-meta';
  const metaParts = [`priority ${task.priority}`];
  if (task.due_at) {
    const date = new Date(task.due_at);
    if (!Number.isNaN(date.getTime())) {
      metaParts.push(`due ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    }
  }
  const childCount = countDescendants(task);
  if (childCount) {
    metaParts.push(`${childCount} subtask${childCount > 1 ? 's' : ''}`);
  }
  if (isWaitingStatusKey(task.status ?? getDefaultStatusKey())) {
    metaParts.push(formatFollowupMeta(task));
  }
  meta.textContent = metaParts.join(' · ');

  card.appendChild(title);
  card.appendChild(meta);
  return card;
}

function countDescendants(task) {
  if (!task.children || !task.children.length) return 0;
  let total = task.children.length;
  task.children.forEach(child => {
    total += countDescendants(child);
  });
  return total;
}

function renderWorkspaceList() {
  workspaceListEl.innerHTML = '';
  if (!state.workspace) return;
  const header = document.createElement('div');
  header.className = 'workspace-dropdown-header';
  header.textContent = 'Workspaces';
  workspaceListEl.appendChild(header);
  const workspaces = (state.workspaces ?? [state.workspace]).filter(ws => !ws.archived);
  if (workspaceDropdownButton) {
    const label = state.workspace.archived ? `${state.workspace.name} (archived)` : state.workspace.name;
    workspaceDropdownButton.textContent = `${label} ▾`;
  }
  if (!workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No active workspaces.';
    workspaceListEl.appendChild(empty);
    return;
  }

  workspaces.forEach(workspace => {
    const row = document.createElement('div');
    row.className = 'workspace-row' + (workspace.id === state.workspace.id ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = workspace.archived ? `${workspace.name} (archived)` : workspace.name;
    selectBtn.addEventListener('click', () => {
      selectWorkspace(workspace);
      workspaceListEl.classList.add('hidden');
      openMenu = null;
    });

    row.appendChild(selectBtn);
    workspaceListEl.appendChild(row);
  });
}

function renderWorkspaceManageList() {
  if (!workspaceManageList) return;
  workspaceManageList.innerHTML = '';
  const workspaces = (state.workspaces ?? []).filter(ws => !ws.archived);
  if (!workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No active workspaces.';
    workspaceManageList.appendChild(empty);
    return;
  }
  workspaces.forEach(workspace => {
    workspaceManageList.appendChild(createWorkspaceManageRow(workspace, false));
  });
}

function renderWorkspaceArchivedList() {
  if (!workspaceArchivedList) return;
  workspaceArchivedList.innerHTML = '';
  const workspaces = (state.workspaces ?? []).filter(ws => ws.archived);
  if (!workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No archived workspaces.';
    workspaceArchivedList.appendChild(empty);
    return;
  }
  workspaces.forEach(workspace => {
    workspaceArchivedList.appendChild(createWorkspaceManageRow(workspace, true));
  });
}

function createWorkspaceManageRow(workspace, isArchivedView) {
  const row = document.createElement('div');
  row.className = 'workspace-row workspace-manage-row' + (workspace.id === state.workspace?.id ? ' active' : '');

  const info = document.createElement('div');
  info.className = 'workspace-manage-info';

  const name = document.createElement('div');
  name.className = 'workspace-manage-name';
  name.textContent = workspace.name;
  info.appendChild(name);

  if (workspace.id === state.workspace?.id && !workspace.archived) {
    const badge = document.createElement('span');
    badge.className = 'workspace-badge';
    badge.textContent = 'Current';
    info.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'workspace-manage-actions';

  if (!isArchivedView) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'subtle-button workspace-manage-button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      const nextName = prompt('Workspace name', workspace.name);
      if (!nextName) return;
      const updatedName = normalizeTitleInput(nextName);
      if (!updatedName) return;
      await api.updateWorkspace(workspace.id, { name: updatedName });
      await reloadWorkspacesAndData();
    });

    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'subtle-button workspace-manage-button';
    archiveBtn.textContent = 'Archive';
    archiveBtn.addEventListener('click', async () => {
      await api.updateWorkspace(workspace.id, { archived: 1 });
      await reloadWorkspacesAndData();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(archiveBtn);
  } else {
    const unarchiveBtn = document.createElement('button');
    unarchiveBtn.type = 'button';
    unarchiveBtn.className = 'subtle-button workspace-manage-button';
    unarchiveBtn.textContent = 'Unarchive';
    unarchiveBtn.addEventListener('click', async () => {
      await api.updateWorkspace(workspace.id, { archived: 0 });
      await reloadWorkspacesAndData();
    });
    actions.appendChild(unarchiveBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger-button workspace-manage-button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    const confirmed = confirm(`Delete workspace \"${workspace.name}\" and all its tasks?`);
    if (!confirmed) return;
    await api.deleteWorkspace(workspace.id);
    await reloadWorkspacesAndData();
  });
  actions.appendChild(deleteBtn);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

function renderTask(task, options = {}) {
  const completedVisibility = normalizeTaskCompletedVisibility(
    options.completedVisibility ?? getTaskCompletedVisibility()
  );
  const futureVisibilityDays = normalizeTaskFutureVisibilityDays(
    options.futureVisibilityDays ?? getTaskFutureVisibilityDays()
  );
  const statusKey = normalizeTaskStatusValue(task.status);
  if (isTaskCompletedAndHidden(task, completedVisibility)) {
    return null;
  }
  if (isTaskBeyondDueHorizon(task, futureVisibilityDays)) {
    return null;
  }
  const template = document.getElementById('task-item-template');
  const node = template.content.cloneNode(true);
  const item = node.querySelector('.task-item');
  const titleEl = node.querySelector('.task-title');
  const metaEl = node.querySelector('.task-meta');
  const statusTag = node.querySelector('.task-status-tag');
  const typeBadge = node.querySelector('.task-type-badge');
  const rowMetaDue = node.querySelector('.task-row-meta-due');
  const rowMetaRepeat = node.querySelector('.task-row-meta-repeat');
  const rowMetaType = node.querySelector('.task-row-meta-type');
  const rowMetaAssignee = node.querySelector('.task-row-meta-assignee');
  const rowMetaStatus = node.querySelector('.task-row-meta-status');
  const toggleBtn = node.querySelector('.task-toggle');
  const completeButton = node.querySelector('.task-complete-button');
  const menuButton = node.querySelector('.task-menu-button');
  const menu = node.querySelector('.task-menu');
  const menuItems = node.querySelectorAll('.task-menu-item');
  const taskActions = node.querySelector('.task-actions');
  const taskMenuWrapper = node.querySelector('.task-menu-wrapper');
  const childrenEl = node.querySelector('.task-children');
  const hasChildren = task.children && task.children.length > 0;
  const collapsedMap = state.ui?.collapsedTasks ?? {};
  const isCollapsed = Boolean(collapsedMap[task.id]);
  const checklistViewActive = isWorkflowChecklistViewActive();
  const checklistInstanceId = checklistViewActive ? getActiveWorkflowChecklistInstanceId() : null;
  const workflowLink = checklistViewActive ? getChecklistLinkForTask(task.id, checklistInstanceId) : null;
  const isChecklistIa = Boolean(workflowLink?.if_applicable);
  const isChecklistDismissed = Boolean(workflowLink?.dismissed_at);
  const isChecklistRowDisabled = checklistViewActive && isChecklistDismissed;

  titleEl.textContent = task.title;
  titleEl.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    if (suppressTaskClick) return;
    if (isChecklistRowDisabled) return;
    const selected = getSelectedTaskIds();
    if (selected.length) return;
    event.stopPropagation();
    beginInlineTaskEdit(task, item, titleEl);
  });
  item.dataset.status = statusKey;
  if (!isChecklistRowDisabled) {
    attachTaskDragHandlers(item, task);
  }
  item.classList.toggle('is-selected', isTaskSelected(task.id));
  item.classList.toggle('workflow-ia-muted', isChecklistRowDisabled);
  item.style.borderLeft = `3px solid ${getStatusColor(statusKey)}`;
  item.setAttribute('aria-disabled', isChecklistRowDisabled ? 'true' : 'false');
  if (statusTag) {
    if (statusKey) {
      statusTag.hidden = false;
      statusTag.textContent = getStatusLabel(statusKey);
      statusTag.style.background = `${getStatusColor(statusKey)}33`;
      statusTag.style.color = getStatusColor(statusKey);
    } else {
      statusTag.hidden = true;
      statusTag.textContent = '';
    }
  }
  const childCount = countDescendants(task);
  const childText = childCount ? ` · ${childCount} subtask${childCount > 1 ? 's' : ''}` : '';
  const waitingText = isWaitingStatusKey(statusKey) ? ` · ${formatFollowupMeta(task)}` : '';
  metaEl.textContent = `priority ${task.priority}${childText}${waitingText}`;
  const recurrenceText = task.recurrence_interval && task.recurrence_unit
    ? ` · repeats every ${task.recurrence_interval} ${task.recurrence_unit}${task.recurrence_interval > 1 ? 's' : ''}`
    : '';
  const hasReminder = task.reminder_offset_days !== null && task.reminder_offset_days !== undefined;
  const reminderText = hasReminder ? ` · reminds ${task.reminder_offset_days}d before` : '';
  if (recurrenceText || reminderText) {
    metaEl.textContent += `${recurrenceText}${reminderText}`;
  }

  const dueMeta = formatTaskDueMeta(task.due_at);
  if (rowMetaDue) {
    rowMetaDue.textContent = dueMeta;
    rowMetaDue.title = task.due_at ? `Due ${dueMeta}` : 'No due date';
    const dueDate = task.due_at ? new Date(task.due_at) : null;
    const isOverdue = Boolean(
      dueDate
      && !Number.isNaN(dueDate.getTime())
      && dueDate.getTime() < Date.now()
      && !isDoneStatusKey(statusKey)
    );
    rowMetaDue.classList.toggle('is-overdue', isOverdue);
  }

  if (rowMetaRepeat) {
    const repeatMeta = formatTaskRepeatMeta(task.recurrence_interval, task.recurrence_unit);
    rowMetaRepeat.textContent = repeatMeta;
    rowMetaRepeat.title = repeatMeta;
  }

  if (rowMetaType) {
    const typeMeta = task.type_label ? task.type_label : 'No type';
    rowMetaType.textContent = typeMeta;
    rowMetaType.title = typeMeta;
  }

  if (rowMetaAssignee) {
    const assigneeMeta = getTaskAssigneeDisplay(task) || 'Unassigned';
    rowMetaAssignee.textContent = assigneeMeta;
    rowMetaAssignee.title = assigneeMeta;
  }

  if (rowMetaStatus) {
    const statusMeta = getStatusLabel(statusKey) || 'No status';
    rowMetaStatus.textContent = statusMeta;
    rowMetaStatus.title = statusMeta;
    const statusColor = getStatusColor(statusKey);
    if (statusColor) {
      rowMetaStatus.style.color = statusColor;
      rowMetaStatus.style.borderColor = `${statusColor}66`;
    } else {
      rowMetaStatus.style.color = '';
      rowMetaStatus.style.borderColor = '';
    }
  }

  if (task.type_label) {
    typeBadge.textContent = task.type_label;
    typeBadge.style.display = 'inline-flex';
    typeBadge.style.background = `hsla(${stringToHue(task.type_label)}, 60%, 35%, 0.35)`;
    typeBadge.style.color = '#e9edf5';
  } else {
    typeBadge.style.display = 'none';
  }
  if (isDoneStatusKey(statusKey)) {
    item.classList.add('completed');
  }

  if (isChecklistIa && taskActions) {
    const iaToggle = document.createElement('button');
    iaToggle.type = 'button';
    iaToggle.className = 'task-ia-toggle';
    if (isChecklistDismissed) {
      iaToggle.classList.add('is-off');
    }
    iaToggle.textContent = 'N/A';
    iaToggle.title = isChecklistDismissed
      ? 'Not applicable right now. Click to keep this task active.'
      : 'If applicable is active. Click to mark this task as not applicable.';
    iaToggle.setAttribute(
      'aria-label',
      isChecklistDismissed
        ? `Mark "${task.title}" applicable`
        : `Mark "${task.title}" not applicable`
    );
    iaToggle.setAttribute('aria-pressed', isChecklistDismissed ? 'false' : 'true');
    iaToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isChecklistDismissed) {
        restoreWorkflowTask(task.id);
      } else {
        dismissWorkflowTask(task.id);
      }
      render();
    });
    taskActions.insertBefore(iaToggle, taskMenuWrapper ?? null);
  }

  completeButton.disabled = isChecklistRowDisabled;
  menuButton.disabled = isChecklistRowDisabled;

  item.addEventListener('click', (event) => {
    if (suppressTaskClick) return;
    if (event.button !== 0) return;
    if (isChecklistRowDisabled) return;
    if (event.target.closest('button')) return;
    if (event.target.closest('.task-drag-handle')) return;
    const selected = getSelectedTaskIds();
    if (!selected.length) return;
    event.preventDefault();
    if (!selected.includes(task.id)) {
      setSelectedTaskIds([...selected, task.id]);
    } else {
      setSelectedTaskIds(selected.filter(id => id !== task.id));
    }
  });

  item.addEventListener('dblclick', (event) => {
    if (suppressTaskClick) return;
    if (isChecklistRowDisabled) return;
    if (event.target.closest('button')) return;
    if (getSelectedTaskIds().length) return;
    openTaskEditor(task.id);
  });

  item.addEventListener('contextmenu', (event) => {
    if (isChecklistRowDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    showTaskContextMenu(task.id, event.clientX, event.clientY);
  });

  if (hasChildren) {
    node.querySelector('.task-main').classList.add('has-children');
    toggleBtn.textContent = isCollapsed ? '▾' : '▴';
    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.ui = state.ui ?? {};
      state.ui.collapsedTasks = state.ui.collapsedTasks ?? {};
      const next = !state.ui.collapsedTasks[task.id];
      state.ui.collapsedTasks[task.id] = next;
      render();
    });
    childrenEl.classList.toggle('hidden', isCollapsed);
  } else {
    toggleBtn.classList.add('hidden');
  }

  if (!isChecklistRowDisabled) {
    attachTaskDropzone(childrenEl, { parentId: task.id });
  }

  completeButton.addEventListener('click', async () => {
    if (isChecklistRowDisabled) return;
    const isDone = isDoneStatusKey(statusKey);
    if (!isDone && hasIncompleteDependencies(task.id)) {
      alert('This task has incomplete dependencies. Complete them first.');
      return;
    }
    if (!isDone && hasIncompleteDescendants(task.id)) {
      const confirmed = confirm('This task has incomplete subtasks. Mark complete anyway?');
      if (!confirmed) return;
    }
    const doneKey = getStatusKeyByKind(TaskStatus.DONE) ?? TaskStatus.DONE;
    const fallbackKey = getFallbackActiveStatusKey();
    const patch = isDone
      ? { status: fallbackKey, completed_at: null }
      : { status: doneKey, completed_at: task.completed_at ?? nowIso() };
    const updated = await updateTaskRecord(task.id, patch);
    if (!updated) return;
    if (!isDone) {
      await maybeCreateRecurringTask(state.tasks[task.id]);
      await maybePromptCompleteParent(task.id);
    }
    render();
  });

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openMenu && openMenu !== menu) {
      openMenu.classList.add('hidden');
    }
    if (menu.classList.contains('hidden')) {
      menu.classList.remove('hidden');
      openMenu = menu;
      item.classList.add('menu-open');
    } else {
      menu.classList.add('hidden');
      openMenu = null;
      item.classList.remove('menu-open');
    }
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  menuItems.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'subtask') {
        const title = prompt('Subtask title');
        if (!title) return;
        await createTaskRecord({
          title,
          parent_id: task.id,
          project_id: task.project_id ?? null,
          task_type: isWorkflowTaskRecord(task, null) ? TASK_TYPE_WORKFLOW : (task.task_type ?? 'task')
        });
        render();
      }
      if (action === 'duplicate') {
        await createTaskRecord({
          title: `${task.title} (copy)`,
          parent_id: task.parent_id,
          project_id: task.project_id ?? null,
          priority: task.priority,
          status: normalizeTaskStatusValue(task.status),
          start_at: task.start_at,
          due_at: task.due_at,
          description_md: task.description_md ?? '',
          type_label: task.type_label ?? null,
          recurrence_interval: task.recurrence_interval ?? null,
          recurrence_unit: task.recurrence_unit ?? null,
          reminder_offset_days: task.reminder_offset_days ?? null,
          auto_debit: task.auto_debit ?? 0
        });
        render();
      }
      if (action === 'edit') {
        openTaskEditor(task.id);
      }
      if (action === 'start-template') {
        const template = (state.templates ?? []).find(t => t.id === task.template_id);
        if (template) {
          await updateTaskRecord(task.id, { template_prompt_pending: 0 });
          await startPlanFromReminder(task, template);
          await refreshWorkspace();
        }
      }
      if (action === 'defer-template') {
        const days = Number(prompt('Defer by how many days?', '3'));
        if (!Number.isFinite(days) || days <= 0) return;
        const newDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        await updateTaskRecord(task.id, { due_at: newDue, template_defer_until: newDue, template_prompt_pending: 0 });
        render();
      }
      if (action === 'dismiss-template') {
        const template = (state.templates ?? []).find(t => t.id === task.template_id);
        if (template) {
          await advanceTemplateDate(template);
        }
        await deleteTaskRecord(task.id);
        render();
      }
      if (action === 'delete') {
        const confirmed = confirm(`Delete "${task.title}" and all subtasks?`);
        if (!confirmed) return;
        await deleteTaskSubtree(task.id);
        render();
      }
      menu.classList.add('hidden');
      openMenu = null;
      item.classList.remove('menu-open');
    });
  });

  const templateItems = menu.querySelectorAll('.template-only');
  templateItems.forEach(item => {
    if (task.template_id) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });

  if (state.ui?.inlineEditTaskId === task.id && !getSelectedTaskIds().length) {
    state.ui.inlineEditTaskId = null;
    beginInlineTaskEdit(task, item, titleEl, { selectAll: true });
  }

  task.children.forEach(child => {
    const childNode = renderTask(child, { completedVisibility, futureVisibilityDays });
    if (childNode) childrenEl.appendChild(childNode);
  });

  return item;
}

async function handleDeleteStatusColumn(status) {
  const tasksInStatus = Object.values(state.tasks).filter(task => task.status === status.key);
  if (tasksInStatus.length) {
    const deleteTasks = confirm(
      `Delete section \"${status.label}\"? OK deletes ${tasksInStatus.length} task${tasksInStatus.length > 1 ? 's' : ''}. ` +
      'Cancel will move them to another section.'
    );
    if (deleteTasks) {
      const confirmed = confirm(`Really delete ${tasksInStatus.length} task${tasksInStatus.length > 1 ? 's' : ''}?`);
      if (!confirmed) return;
      for (const task of tasksInStatus) {
        await deleteTaskRecord(task.id);
      }
    } else {
      const options = getStatusDefinitions()
        .filter(s => s.key !== status.key)
        .map(s => `${s.label} (${s.key})`)
        .join('\n');
      const choice = prompt(`Move tasks to which section? Enter name or key:\n${options}`);
      if (!choice) return;
      const normalized = choice.trim().toLowerCase();
      const target = getStatusDefinitions().find(s =>
        s.key.toLowerCase() === normalized || s.label.toLowerCase() === normalized
      );
      if (!target) {
        alert('Section not found.');
        return;
      }
      let nextSort = getNextTaskSortOrder(null, target.key);
      for (const task of tasksInStatus) {
        await updateTaskRecord(task.id, { status: target.key, sort_order: nextSort });
        nextSort += 10;
      }
    }
  }
  await deleteStatusRecord(status.id);
  await refreshWorkspace();
}

async function handleCheckIn(task, response) {
  const updated = applyCheckIn(task, response, new Date());
  await updateTaskRecord(task.id, {
    status: updated.status,
    completed_at: updated.completed_at ?? null,
    next_checkin_at: updated.next_checkin_at ?? null,
    waiting_followup_at: updated.status === TaskStatus.WAITING ? task.waiting_followup_at ?? null : null
  });
  if (isDoneStatusKey(updated.status)) {
    await maybeCreateRecurringTask(state.tasks[task.id]);
    await maybePromptCompleteParent(task.id);
  }
  render();
}

async function deleteTaskSubtree(taskId) {
  await deleteTaskRecord(taskId);
}

function getDescendants(taskId) {
  const descendants = [];
  const ids = new Set([taskId]);
  let added = true;
  while (added) {
    added = false;
    for (const task of Object.values(state.tasks)) {
      if (task.parent_id && ids.has(task.parent_id) && !ids.has(task.id)) {
        ids.add(task.id);
        descendants.push(task);
        added = true;
      }
    }
  }
  return descendants;
}

function getRootTaskIds(taskIds) {
  const ids = new Set(taskIds);
  const descendants = new Set();
  taskIds.forEach(id => {
    getDescendants(id).forEach(task => descendants.add(task.id));
  });
  return taskIds.filter(id => !descendants.has(id));
}

function collectTaskSnapshots(taskIds) {
  const snapshots = [];
  const seen = new Set();
  taskIds.forEach(id => {
    const task = state.tasks[id];
    if (!task) return;
    if (!seen.has(task.id)) {
      snapshots.push({ ...task });
      seen.add(task.id);
    }
    getDescendants(id).forEach(desc => {
      if (seen.has(desc.id)) return;
      snapshots.push({ ...desc });
      seen.add(desc.id);
    });
  });
  return snapshots;
}

async function restoreTasksFromSnapshots(snapshots) {
  if (!snapshots.length) return;
  const snapshotMap = new Map(snapshots.map(task => [task.id, task]));
  const depthCache = new Map();
  const getDepth = (taskId) => {
    if (depthCache.has(taskId)) return depthCache.get(taskId);
    const task = snapshotMap.get(taskId);
    if (!task || !task.parent_id || !snapshotMap.has(task.parent_id)) {
      depthCache.set(taskId, 0);
      return 0;
    }
    const depth = getDepth(task.parent_id) + 1;
    depthCache.set(taskId, depth);
    return depth;
  };
  const sorted = [...snapshots].sort((a, b) => getDepth(a.id) - getDepth(b.id));
  const idMap = new Map();
  for (const task of sorted) {
    const parentId = task.parent_id && idMap.has(task.parent_id) ? idMap.get(task.parent_id) : null;
    const created = await createTaskRecord({
      title: task.title,
      description_md: task.description_md ?? '',
      status: normalizeTaskStatusValue(task.status),
      priority: task.priority ?? 'medium',
      type_label: task.type_label ?? null,
      project_id: task.project_id ?? null,
      parent_id: parentId,
      recurrence_interval: task.recurrence_interval ?? null,
      recurrence_unit: task.recurrence_unit ?? null,
      reminder_offset_days: task.reminder_offset_days ?? null,
      auto_debit: task.auto_debit ?? 0,
      reminder_sent_at: task.reminder_sent_at ?? null,
      recurrence_parent_id: task.recurrence_parent_id ?? null,
      recurrence_generated_at: task.recurrence_generated_at ?? null,
      template_id: task.template_id ?? null,
      template_state: task.template_state ?? null,
      template_event_date: task.template_event_date ?? null,
      template_lead_days: task.template_lead_days ?? null,
      template_defer_until: task.template_defer_until ?? null,
      template_prompt_pending: task.template_prompt_pending ?? null,
      start_at: task.start_at ?? null,
      due_at: task.due_at ?? null,
      waiting_followup_at: task.waiting_followup_at ?? null,
      next_checkin_at: task.next_checkin_at ?? null,
      sort_order: task.sort_order ?? null,
      task_type: task.task_type ?? 'task'
    });
    if (!created) continue;
    idMap.set(task.id, created.id);
    if (task.completed_at) {
      await updateTaskRecord(created.id, { completed_at: task.completed_at });
    }
  }
}

function hasIncompleteDescendants(taskId) {
  return getDescendants(taskId).some(task => !isDoneStatusKey(task.status));
}

function hasIncompleteDependencies(taskId) {
  const deps = getDependenciesForTask(taskId);
  return deps.some(dep => {
    const task = state.tasks?.[dep.depends_on_id];
    if (!task) return true;
    return !isDoneStatusKey(task.status ?? getDefaultStatusKey());
  });
}

function allDescendantsComplete(taskId) {
  const descendants = getDescendants(taskId);
  if (!descendants.length) return false;
  return descendants.every(task => isDoneStatusKey(task.status));
}

async function maybePromptCompleteParent(taskId) {
  const task = state.tasks[taskId];
  if (!task?.parent_id) return;
  const parent = state.tasks[task.parent_id];
  if (!parent) return;
  if (isDoneStatusKey(parent.status) || isCanceledStatusKey(parent.status)) return;
  if (!allDescendantsComplete(parent.id)) return;

  const confirmed = confirm(`All subtasks are complete. Mark \"${parent.title}\" complete?`);
  if (!confirmed) return;
  await updateTaskRecord(parent.id, {
    status: getStatusKeyByKind(TaskStatus.DONE) ?? TaskStatus.DONE,
    completed_at: parent.completed_at ?? nowIso()
  });
}

async function maybeCreateRecurringTask(task) {
  if (!task) return;
  if (!task.recurrence_interval || !task.recurrence_unit) return;
  if (task.recurrence_generated_at) return;
  const baseDate = task.due_at || task.start_at;
  if (!baseDate) return;

  const interval = Number(task.recurrence_interval);
  if (!interval || interval < 1) return;

  const nextDue = task.due_at ? addInterval(new Date(task.due_at), interval, task.recurrence_unit) : null;
  const nextStart = task.start_at ? addInterval(new Date(task.start_at), interval, task.recurrence_unit) : null;

  await createTaskRecord({
    title: task.title,
    parent_id: task.parent_id,
    project_id: task.project_id ?? null,
    priority: task.priority,
    status: getStatusKeyByKind(TaskStatus.PLANNED) ?? getDefaultStatusKey(),
    start_at: nextStart ? nextStart.toISOString() : null,
    due_at: nextDue ? nextDue.toISOString() : null,
    description_md: task.description_md ?? '',
    type_label: task.type_label ?? null,
    recurrence_interval: task.recurrence_interval,
    recurrence_unit: task.recurrence_unit,
    reminder_offset_days: task.reminder_offset_days ?? null,
    auto_debit: task.auto_debit ?? 0,
    recurrence_parent_id: task.id
  });
  await updateTaskRecord(task.id, { recurrence_generated_at: nowIso() });
}

function parseTemplateSteps(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length === 1) {
        return { title: parts[0], offset_days: null };
      }
      const offset = Number(parts[1]);
      return { title: parts[0], offset_days: Number.isFinite(offset) ? offset : null };
    });
}

function renderWorkflowList() {
  if (!workflowListEl) return;
  if (!state.workspace) {
    workflowListEl.innerHTML = '';
    return;
  }
  workflowListEl.innerHTML = '';
  const workflows = getWorkflowsForWorkspace();
  let activeId = getActiveWorkflowId();
  if (activeId && !workflows.some(workflow => workflow.id === activeId)) {
    setActiveWorkflowId(null);
    activeId = null;
  }
  if (!workflows.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No workflows yet.';
    workflowListEl.appendChild(empty);
    return;
  }

  workflows.forEach(workflow => {
    const row = document.createElement('div');
    row.className = 'workspace-row' + (workflow.id === activeId ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = workflow.name;
    selectBtn.addEventListener('click', () => {
      setWorkflowViewMode('runs');
      setWorkflowInstanceFilter('open');
      setActiveWorkflowId(workflow.id);
      setActiveView('workflows');
      render();
    });

    row.appendChild(selectBtn);
    workflowListEl.appendChild(row);
  });
}

function formatTemplateSteps(steps = []) {
  return steps
    .map(step => step.offset_days !== null && step.offset_days !== undefined
      ? `${step.title} | ${step.offset_days}`
      : step.title
    )
    .join('\n');
}

function openTemplateManagerModal() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  templateManagerModal?.classList.remove('hidden');
  renderTemplateList();
}

function closeTemplateManagerModal({ reopenSettings = true } = {}) {
  templateManagerModal?.classList.add('hidden');
  if (reopenSettings) openSettings();
}

function openTemplateModal(template = null) {
  if (templateManagerModal && !templateManagerModal.classList.contains('hidden')) {
    templateEditorReturnTo = 'template-manager';
    closeTemplateManagerModal({ reopenSettings: false });
  } else if (settingsModal && !settingsModal.classList.contains('hidden')) {
    templateEditorReturnTo = 'settings';
    closeSettings();
  } else {
    templateEditorReturnTo = 'settings';
  }
  editingTemplateId = template?.id ?? null;
  templateName.value = template?.name ?? '';
  templateSteps.value = formatTemplateSteps(template?.steps ?? []);
  templateLeadDays.value = template?.lead_days ?? '';
  templateNextDate.value = template?.next_event_date ?? '';
  templateRepeatInterval.value = template?.recurrence_interval ?? '';
  templateRepeatUnit.value = template?.recurrence_unit ?? 'year';
  populateProjectSelect(templateProject, template?.project_id ?? '', true);
  templateModal.classList.remove('hidden');
  templateName.focus();
}

function closeTemplateModal() {
  templateModal.classList.add('hidden');
  editingTemplateId = null;
  if (templateEditorReturnTo === 'template-manager') {
    openTemplateManagerModal();
  } else {
    openSettings();
  }
  templateEditorReturnTo = 'settings';
}

function openWorkflowModal(workflow = null) {
  if (!workflowModal || !workflowNameInput) return;
  editingWorkflowId = workflow?.id ?? null;
  if (workflowModalTitle) {
    workflowModalTitle.textContent = workflow ? 'Edit Blueprint' : 'New Blueprint';
  }
  workflowNameInput.value = workflow?.name ?? '';
  if (workflowDescriptionInput) workflowDescriptionInput.value = workflow?.description ?? '';
  workflowModal.classList.remove('hidden');
  workflowNameInput.focus();
}

function closeWorkflowModal() {
  workflowModal?.classList.add('hidden');
  editingWorkflowId = null;
}

function populateWorkflowInstanceVariantSelect(workflowId, selectedId = null) {
  if (!workflowInstanceVariant) return;
  workflowInstanceVariant.innerHTML = '';
  const variants = getWorkflowVariants(workflowId);
  if (!variants.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'No types available';
    workflowInstanceVariant.appendChild(placeholder);
    workflowInstanceVariant.value = '';
    return;
  }
  variants.forEach(variant => {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.name;
    workflowInstanceVariant.appendChild(option);
  });
  workflowInstanceVariant.value = selectedId ?? variants[0].id;
}

function openWorkflowInstanceModal() {
  if (!workflowInstanceModal || !workflowInstanceTitleInput) return;
  const workflowId = getActiveWorkflowId();
  if (!workflowId) return;
  populateWorkflowInstanceVariantSelect(workflowId, getActiveWorkflowVariantId());
  workflowInstanceTitleInput.value = '';
  if (workflowInstanceNotesInput) workflowInstanceNotesInput.value = '';
  workflowInstanceModal.classList.remove('hidden');
  workflowInstanceTitleInput.focus();
}

function closeWorkflowInstanceModal() {
  workflowInstanceModal?.classList.add('hidden');
}

function openSettings(preferredTab = null) {
  templateManagerModal?.classList.add('hidden');
  setSettingsTab(preferredTab ?? getDefaultSettingsTab());
  settingsModal?.classList.remove('hidden');
  renderSettingsTabs();
  renderAuditLogOutput();
}

function closeSettings() {
  settingsModal?.classList.add('hidden');
}

function openSettingsLinkedPage(view) {
  state.ui = state.ui ?? {};
  state.ui.settingsReturnView = getActiveView();
  state.ui.settingsReturnTab = getSettingsTab();
  closeSettings();
  setActiveView(view);
  render();
}

function returnFromSettingsLinkedPage() {
  state.ui = state.ui ?? {};
  const returnView = state.ui.settingsReturnView ?? 'tasks';
  const returnTab = state.ui.settingsReturnTab ?? null;
  setActiveView(returnView);
  openSettings(returnTab);
  render();
}

function openProfile() {
  state.ui = state.ui ?? {};
  const currentView = getActiveView();
  state.ui.profileReturnView = currentView === 'profile' ? (state.ui.profileReturnView ?? 'tasks') : currentView;
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  setActiveView('profile');
  render();
}

function closeProfile() {
  state.ui = state.ui ?? {};
  const returnView = normalizeNavigationView(state.ui.profileReturnView ?? 'tasks');
  setActiveView(returnView === 'profile' ? 'tasks' : returnView);
  render();
}

function openAdminConsole() {
  if (!isCurrentActorAdmin()) {
    alert('Admin access required.');
    return;
  }
  state.ui = state.ui ?? {};
  const currentView = getActiveView();
  state.ui.adminReturnView = currentView === 'admin' ? (state.ui.adminReturnView ?? 'tasks') : currentView;
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  setActiveView('admin');
  render();
  void refreshAdminInvites();
  void refreshAdminUsers();
  startAdminInvitesAutoRefresh();
  startAdminUsersAutoRefresh();
}

function closeAdminConsole() {
  stopAdminInvitesAutoRefresh();
  stopAdminUsersAutoRefresh();
  state.ui = state.ui ?? {};
  const returnView = normalizeNavigationView(state.ui.adminReturnView ?? 'tasks');
  setActiveView(returnView === 'admin' ? 'tasks' : returnView);
  render();
}

function openBulkEditModal() {
  if (!bulkEditModal) return;
  const selected = getSelectedTaskIds();
  if (!selected.length) return;
  if (bulkEditCount) {
    bulkEditCount.textContent = `${selected.length} task${selected.length > 1 ? 's' : ''} selected`;
  }
  if (bulkEditApplyStatus) bulkEditApplyStatus.checked = false;
  if (bulkEditApplyPriority) bulkEditApplyPriority.checked = false;
  if (bulkEditApplyProject) bulkEditApplyProject.checked = false;
  if (bulkEditApplyType) bulkEditApplyType.checked = false;
  if (bulkEditApplyStart) bulkEditApplyStart.checked = false;
  if (bulkEditApplyDue) bulkEditApplyDue.checked = false;
  if (bulkEditApplyReminder) bulkEditApplyReminder.checked = false;
  populateStatusSelect(bulkEditStatus, getDefaultStatusKey());
  populateProjectSelect(bulkEditProject, '', true);
  populateTaskTypeSelect(bulkEditType, '');
  if (bulkEditPriority) bulkEditPriority.value = 'medium';
  if (bulkEditStart) bulkEditStart.value = '';
  if (bulkEditDue) bulkEditDue.value = '';
  if (bulkEditReminder) bulkEditReminder.value = '';
  bulkEditModal.classList.remove('hidden');
}

function closeBulkEditModal() {
  bulkEditModal?.classList.add('hidden');
}

function openGroupRenameModal(sectionInfo) {
  if (!groupRenameModal || !groupRenameInput) return;
  if (!sectionInfo?.label) return;
  renameGroupTarget = {
    id: sectionInfo.id ?? null,
    label: String(sectionInfo.label ?? ''),
    project_id: normalizeSectionScopeProjectId(sectionInfo.project_id)
  };
  groupRenameInput.value = renameGroupTarget.label;
  groupRenameModal.classList.remove('hidden');
  groupRenameInput.focus();
  groupRenameInput.select();
}

function closeGroupRenameModal() {
  groupRenameModal?.classList.add('hidden');
  renameGroupTarget = null;
}

function openSectionSettingsModal(sectionInfo) {
  if (!sectionSettingsModal || !sectionSettingsCompleted || !sectionSettingsFutureDays) return;
  if (!sectionInfo?.label) return;
  sectionSettingsTarget = {
    id: sectionInfo.id ?? null,
    label: String(sectionInfo.label ?? ''),
    project_id: normalizeSectionScopeProjectId(sectionInfo.project_id)
  };
  const completedOverride = getTaskSectionCompletedVisibilityOverride(sectionInfo);
  const futureDaysOverride = getTaskSectionFutureVisibilityOverrideDays(sectionInfo);
  const appCompleted = getTaskCompletedVisibility();
  const appFutureDays = getTaskFutureVisibilityDays();
  if (sectionSettingsTitle) {
    sectionSettingsTitle.textContent = `Section settings: ${sectionSettingsTarget.label}`;
  }
  sectionSettingsCompleted.value = completedOverride ?? 'default';
  sectionSettingsFutureDays.value = futureDaysOverride === null ? '' : String(futureDaysOverride);
  if (sectionSettingsDefaults) {
    const appCompletedLabel = appCompleted === 'hide' ? 'Hide completed' : 'Show crossed out';
    const appFutureLabel = `${appFutureDays} day${appFutureDays === 1 ? '' : 's'}`;
    sectionSettingsDefaults.textContent = `App defaults: ${appCompletedLabel}; horizon ${appFutureLabel}.`;
  }
  sectionSettingsModal.classList.remove('hidden');
}

function closeSectionSettingsModal() {
  sectionSettingsModal?.classList.add('hidden');
  sectionSettingsTarget = null;
}

function buildBulkEditTemplate() {
  const template = {};
  const fields = new Set();
  if (bulkEditApplyStatus?.checked && bulkEditStatus?.value) {
    template.status = bulkEditStatus.value;
    fields.add('status');
    fields.add('waiting_followup_at');
    fields.add('next_checkin_at');
    fields.add('completed_at');
  }
  if (bulkEditApplyPriority?.checked && bulkEditPriority?.value) {
    template.priority = bulkEditPriority.value;
    fields.add('priority');
  }
  if (bulkEditApplyProject?.checked) {
    template.project_id = bulkEditProject?.value || null;
    fields.add('project_id');
  }
  if (bulkEditApplyType?.checked) {
    template.type_label = bulkEditType?.value || null;
    fields.add('type_label');
  }
  if (bulkEditApplyStart?.checked) {
    template.start_at = fromDatetimeLocal(bulkEditStart?.value ?? '');
    fields.add('start_at');
  }
  if (bulkEditApplyDue?.checked) {
    template.due_at = fromDatetimeLocal(bulkEditDue?.value ?? '');
    fields.add('due_at');
  }
  if (bulkEditApplyReminder?.checked) {
    const reminderValue = parseInt(bulkEditReminder?.value ?? '', 10);
    template.reminder_offset_days = Number.isFinite(reminderValue) ? reminderValue : null;
    fields.add('reminder_offset_days');
  }
  return { template, fields: Array.from(fields) };
}

function buildBulkUndoSnapshot(task, fields) {
  const before = {};
  fields.forEach(field => {
    before[field] = task[field] ?? null;
  });
  return { id: task.id, before };
}

function buildBulkPatchForTask(task, template) {
  const patch = { ...template };
  if ('status' in template) {
    const nextStatus = template.status;
    if (isWaitingStatusKey(nextStatus)) {
      if (!('waiting_followup_at' in patch)) {
        const waitingTask = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date());
        patch.next_checkin_at = waitingTask.next_checkin_at;
      }
    } else {
      patch.waiting_followup_at = null;
      if (task.waiting_followup_at && task.next_checkin_at === task.waiting_followup_at) {
        patch.next_checkin_at = null;
      }
    }
    if (isDoneStatusKey(nextStatus)) {
      patch.completed_at = task.completed_at ?? nowIso();
    } else {
      patch.completed_at = null;
    }
  }
  return patch;
}

async function applyBulkEdit() {
  const selected = getSelectedTaskIds();
  if (!selected.length) return;
  const { template, fields } = buildBulkEditTemplate();
  if (!Object.keys(template).length) {
    closeBulkEditModal();
    return;
  }
  const snapshots = [];
  for (const taskId of selected) {
    const task = state.tasks[taskId];
    if (!task) continue;
    snapshots.push(buildBulkUndoSnapshot(task, fields));
    const patch = buildBulkPatchForTask(task, template);
    await updateTaskRecord(task.id, patch);
    if (patch.status && isDoneStatusKey(patch.status)) {
      await maybeCreateRecurringTask(state.tasks[task.id]);
      await maybePromptCompleteParent(task.id);
    }
  }
  pushBulkUndo({
    id: createId(),
    kind: 'edit',
    created_at: nowIso(),
    label: `Bulk edit (${snapshots.length} task${snapshots.length > 1 ? 's' : ''})`,
    tasks: snapshots
  });
  closeBulkEditModal();
  render();
}

async function handleBulkDelete() {
  const selected = getSelectedTaskIds();
  if (!selected.length) return;
  const roots = getRootTaskIds(selected);
  const snapshots = collectTaskSnapshots(roots);
  const confirmed = confirm(`Delete ${roots.length} task${roots.length > 1 ? 's' : ''} and all subtasks?`);
  if (!confirmed) return;
  for (const taskId of roots) {
    await deleteTaskSubtree(taskId);
  }
  pushBulkUndo({
    id: createId(),
    kind: 'delete',
    created_at: nowIso(),
    label: `Bulk delete (${snapshots.length} task${snapshots.length > 1 ? 's' : ''})`,
    tasks: snapshots
  });
  clearSelectedTasks();
  render();
}

async function renameTaskGroup(sectionInfo, nextName) {
  if (!sectionInfo?.label) return;
  const sourceLabel = String(sectionInfo.label ?? '').trim();
  if (!sourceLabel) return;
  const updatedName = normalizeTitleInput(nextName);
  if (!updatedName || updatedName === sourceLabel) return;
  const workspaceId = state.workspace?.id;
  if (!workspaceId) return;
  const scopeProjectId = normalizeSectionScopeProjectId(sectionInfo.project_id);
  const sections = [...(state.taskSections ?? [])].map(normalizeTaskSection);
  const sectionId = sectionInfo.id ?? null;
  let existingIndex = sections.findIndex((section) =>
    section.id === sectionId
    && section.workspace_id === workspaceId
    && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
  );
  if (existingIndex < 0) {
    existingIndex = sections.findIndex((section) =>
      section.workspace_id === workspaceId
      && section.label === sourceLabel
      && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
    );
  }
  const existingSection = existingIndex >= 0 ? sections[existingIndex] : null;
  const duplicateIndex = sections.findIndex((section, index) =>
    index !== existingIndex
    && section.workspace_id === workspaceId
    && section.label === updatedName
    && normalizeSectionScopeProjectId(section.project_id) === scopeProjectId
  );
  if (existingSection) {
    if (duplicateIndex >= 0) {
      sections.splice(existingIndex, 1);
    } else {
      sections[existingIndex] = {
        ...existingSection,
        label: updatedName,
        updated_at: nowIso()
      };
    }
    state.taskSections = sections;
    persistLocalData();
  }
  const tasks = Object.values(state.tasks ?? {});
  for (const task of tasks) {
    if (task.workspace_id !== workspaceId) continue;
    if (!taskMatchesSectionScope(task, scopeProjectId)) continue;
    const currentLabel = (task.group_label ?? '').trim();
    if (currentLabel !== sourceLabel) continue;
    await updateTaskRecord(task.id, { group_label: updatedName });
  }
  render();
}

function showTaskGroupContextMenu(sectionInfo, x, y) {
  if (!sectionInfo?.label) return;
  if (!taskContextMenu) return;
  if (openMenu && openMenu !== taskContextMenu) {
    openMenu.classList.add('hidden');
  }
  taskContextMenu.innerHTML = '';

  const settingsItem = document.createElement('button');
  settingsItem.type = 'button';
  settingsItem.className = 'workspace-menu-item';
  settingsItem.textContent = 'Section settings';
  settingsItem.addEventListener('click', () => {
    taskContextMenu.classList.add('hidden');
    openMenu = null;
    openSectionSettingsModal(sectionInfo);
  });
  taskContextMenu.appendChild(settingsItem);

  const renameItem = document.createElement('button');
  renameItem.type = 'button';
  renameItem.className = 'workspace-menu-item';
  renameItem.textContent = 'Rename section';
  renameItem.addEventListener('click', () => {
    taskContextMenu.classList.add('hidden');
    openMenu = null;
    openGroupRenameModal(sectionInfo);
  });
  taskContextMenu.appendChild(renameItem);

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.className = 'workspace-menu-item';
  deleteItem.textContent = 'Delete section';
  deleteItem.addEventListener('click', async () => {
    taskContextMenu.classList.add('hidden');
    openMenu = null;
    const confirmed = confirm(`Delete section "${sectionInfo.label}"? Tasks will be moved out of the section.`);
    if (!confirmed) return;
    await deleteTaskSection(sectionInfo);
  });
  taskContextMenu.appendChild(deleteItem);

  taskContextMenu.classList.remove('hidden');
  openMenu = taskContextMenu;
  const menuRect = taskContextMenu.getBoundingClientRect();
  const nextLeft = Math.min(x, window.innerWidth - menuRect.width - 8);
  const nextTop = Math.min(y, window.innerHeight - menuRect.height - 8);
  taskContextMenu.style.left = `${Math.max(8, nextLeft)}px`;
  taskContextMenu.style.top = `${Math.max(8, nextTop)}px`;
}

function showTaskContextMenu(taskId, x, y) {
  if (!taskContextMenu) return;
  if (openMenu && openMenu !== taskContextMenu) {
    openMenu.classList.add('hidden');
  }
  const selected = getSelectedTaskIds();
  const hasSelection = selected.length > 0;
  const isSelected = selected.includes(taskId);
  taskContextMenu.innerHTML = '';

  if (!hasSelection) {
    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete Task';
    deleteItem.addEventListener('click', async () => {
      taskContextMenu.classList.add('hidden');
      openMenu = null;
      const task = state.tasks?.[taskId];
      if (!task) return;
      const confirmed = confirm(`Delete "${task.title}" and all subtasks?`);
      if (!confirmed) return;
      await deleteTaskSubtree(taskId);
      render();
    });
    taskContextMenu.appendChild(deleteItem);

    const selectItem = document.createElement('button');
    selectItem.type = 'button';
    selectItem.className = 'workspace-menu-item';
    selectItem.textContent = 'Select Task';
    selectItem.addEventListener('click', () => {
      setSelectedTaskIds([taskId]);
      taskContextMenu.classList.add('hidden');
      openMenu = null;
      render();
    });
    taskContextMenu.appendChild(selectItem);
  } else {
    const bulkEditItem = document.createElement('button');
    bulkEditItem.type = 'button';
    bulkEditItem.className = 'workspace-menu-item';
    bulkEditItem.textContent = 'Bulk edit';
    bulkEditItem.addEventListener('click', () => {
      if (!isSelected) {
        setSelectedTaskIds([...selected, taskId]);
      }
      openBulkEditModal();
      taskContextMenu.classList.add('hidden');
      openMenu = null;
    });
    taskContextMenu.appendChild(bulkEditItem);

    const bulkDeleteItem = document.createElement('button');
    bulkDeleteItem.type = 'button';
    bulkDeleteItem.className = 'workspace-menu-item';
    bulkDeleteItem.textContent = 'Bulk delete';
    bulkDeleteItem.addEventListener('click', async () => {
      if (!isSelected) {
        setSelectedTaskIds([...selected, taskId]);
      }
      taskContextMenu.classList.add('hidden');
      openMenu = null;
      await handleBulkDelete();
    });
    taskContextMenu.appendChild(bulkDeleteItem);

    const clearItem = document.createElement('button');
    clearItem.type = 'button';
    clearItem.className = 'workspace-menu-item';
    clearItem.textContent = 'Clear selection';
    clearItem.addEventListener('click', () => {
      clearSelectedTasks();
      taskContextMenu.classList.add('hidden');
      openMenu = null;
      render();
    });
    taskContextMenu.appendChild(clearItem);
  }

  taskContextMenu.classList.remove('hidden');
  openMenu = taskContextMenu;
  const menuRect = taskContextMenu.getBoundingClientRect();
  const nextLeft = Math.min(x, window.innerWidth - menuRect.width - 8);
  const nextTop = Math.min(y, window.innerHeight - menuRect.height - 8);
  taskContextMenu.style.left = `${Math.max(8, nextLeft)}px`;
  taskContextMenu.style.top = `${Math.max(8, nextTop)}px`;
}

function openTaskTypesModal() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  taskTypesModal?.classList.remove('hidden');
  taskTypeNameInput?.focus();
}

function closeTaskTypesModal() {
  taskTypesModal?.classList.add('hidden');
  openSettings();
}

function openScheduleEventTypesModal() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  scheduleEventTypesModal?.classList.remove('hidden');
  renderScheduleEventTypeList();
  if (scheduleEventTypeColorInput) {
    scheduleEventTypeColorInput.value = getNextScheduleEventTypeColor();
  }
  scheduleEventTypeNameInput?.focus();
}

function closeScheduleEventTypesModal() {
  scheduleEventTypesModal?.classList.add('hidden');
  openSettings('scheduling');
}

function openStoreRulesModal() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  storeRulesModal?.classList.remove('hidden');
  storeRuleNameInput?.focus();
}

function closeStoreRulesModal() {
  storeRulesModal?.classList.add('hidden');
  openSettings();
}

function openTaskColumnsModal() {
  if (!taskColumnsModal) return;
  taskColumnsModal.classList.remove('hidden');
  renderTaskColumnsModal();
}

function closeTaskColumnsModal() {
  taskColumnsModal?.classList.add('hidden');
}

function renderTaskColumnsModal() {
  if (!taskColumnsList) return;
  taskColumnsList.innerHTML = '';
  const statuses = getStatusDefinitions();
  statuses.forEach(status => {
    const row = document.createElement('div');
    row.className = 'column-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = status.label;
    input.addEventListener('change', async () => {
      const nextLabel = input.value.trim();
      if (!nextLabel || nextLabel === status.label) return;
      await updateStatusRecord(status.id, { label: nextLabel });
      render();
    });

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'inline';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(status.kanban_visible);
    checkbox.addEventListener('change', async () => {
      await updateStatusRecord(status.id, { kanban_visible: checkbox.checked ? 1 : 0 });
      render();
    });
    const checkboxText = document.createElement('span');
    checkboxText.textContent = 'Keep section when empty';
    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(checkboxText);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-button column-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete status';
    deleteBtn.disabled = status.kind !== 'custom';
    deleteBtn.addEventListener('click', async () => {
      if (status.kind !== 'custom') return;
      const confirmed = confirm(`Delete status \"${status.label}\"? Tasks will be moved to Inbox.`);
      if (!confirmed) return;
      await deleteStatusRecord(status.id);
      await refreshWorkspace();
    });

    row.appendChild(input);
    row.appendChild(checkboxLabel);
    row.appendChild(deleteBtn);
    taskColumnsList.appendChild(row);
  });
}

function getStoreNames() {
  return (state.storeRules ?? [])
    .filter(rule => !rule.archived)
    .map(rule => rule.store_name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function renderShoppingStoreSelect(selectedName = '') {
  if (!shoppingListStoreSelect) return;
  const storeNames = getStoreNames();
  shoppingListStoreSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select store...';
  shoppingListStoreSelect.appendChild(placeholder);
  storeNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    shoppingListStoreSelect.appendChild(option);
  });
  const addNew = document.createElement('option');
  addNew.value = '__add_new__';
  addNew.textContent = 'Add new store…';
  shoppingListStoreSelect.appendChild(addNew);
  shoppingListStoreSelect.value = selectedName && storeNames.includes(selectedName)
    ? selectedName
    : '';
}

function openShoppingStoreModal() {
  if (!shoppingStoreModal) return;
  shoppingStoreModal.classList.remove('hidden');
  if (shoppingStoreNameInput) {
    shoppingStoreNameInput.value = '';
    shoppingStoreNameInput.focus();
  }
}

function closeShoppingStoreModal(options = {}) {
  const { restoreSelection = true } = options;
  shoppingStoreModal?.classList.add('hidden');
  if (shoppingStoreNameInput) shoppingStoreNameInput.value = '';
  if (!restoreSelection || !shoppingListStoreSelect) return;
  const previous = shoppingStorePreviousSelection;
  shoppingListStoreSelect.value = previous && previous !== '__add_new__' ? previous : '';
}

function openShoppingListModal() {
  if (shoppingListStoreSelect) renderShoppingStoreSelect('');
  shoppingStorePreviousSelection = '';
  closeShoppingStoreModal({ restoreSelection: false });
  if (shoppingListDate) {
    shoppingListDate.value = new Date().toISOString().slice(0, 10);
  }
  shoppingListItemsInput.value = '';
  shoppingListModal.classList.remove('hidden');
  shoppingListStoreSelect?.focus();
}

function closeShoppingListModal() {
  shoppingListModal.classList.add('hidden');
  closeShoppingStoreModal({ restoreSelection: false });
}

function openShoppingItemModal() {
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  shoppingItemInput.value = '';
  shoppingItemModal.classList.remove('hidden');
  shoppingItemInput.focus();
}

function closeShoppingItemModal() {
  shoppingItemModal.classList.add('hidden');
}

function populateTaskEditor(task) {
  if (!task) return;
  isPopulatingTaskEditor = true;
  try {
    editorTitle.value = task.title ?? '';
    populateTaskTypeSelect(editorType, task.type_label ?? '');
    if (editorTags) editorTags.value = formatTagList(task.tags ?? []);
    editorPriority.value = task.priority ?? 'medium';
    if (editorProject) {
      populateProjectSelect(editorProject, task.project_id ?? '', true);
    }
    populateParentSelect(editorParent, task.id, task.parent_id ?? null);
    if (editorAssigneeLabel) editorAssigneeLabel.value = task.assignee_label ?? '';
    populateAssigneeSelect(
      editorAssignee,
      editorAssigneeLabelRow,
      editorAssigneeLabel,
      task.assignee_user_id ?? null,
      task.assignee_label ?? ''
    );
    setRecurrenceState('editor', task.recurrence_interval ?? null, task.recurrence_unit ?? 'month');
    editorReminder.value = task.reminder_offset_days ?? '';
    populateStatusSelect(editorStatus, normalizeTaskStatusValue(task.status));
    updateEditorFollowupVisibility(editorStatus.value);
    const followupValue = task.waiting_followup_at ?? task.next_checkin_at ?? null;
    setEditorFollowupValue(followupValue);
    if (editorStart) editorStart.value = toDatetimeLocal(task.start_at);
    editorDue.value = toDatetimeLocal(task.due_at);
    setNotesContent(task.description_md ?? '');
    renderTaskEditorSubtasks(task);
    renderTaskEditorDependencies(task);
    populateDependencySelect(task);
  } finally {
    isPopulatingTaskEditor = false;
  }
}

function renderTaskEditorSubtasks(task) {
  if (!editorSubtaskList || !editorSubtaskCount || !task) return;
  editorSubtaskList.innerHTML = '';
  const subtasks = Object.values(state.tasks ?? {})
    .filter(item => item.parent_id === task.id)
    .sort(compareTasksByPriority);
  editorSubtaskCount.textContent = `${subtasks.length}`;
  if (!subtasks.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No subtasks yet.';
    editorSubtaskList.appendChild(empty);
    return;
  }
  subtasks.forEach(subtask => {
    const row = document.createElement('div');
    row.className = 'task-editor-subtask-item';
    row.addEventListener('click', () => openTaskEditor(subtask.id));
    const title = document.createElement('span');
    title.className = 'task-editor-subtask-title';
    title.textContent = subtask.title;
    const meta = document.createElement('span');
    meta.className = 'task-editor-subtask-meta';
    meta.textContent = getStatusLabel(normalizeTaskStatusValue(subtask.status)) || 'No status';
    row.appendChild(title);
    row.appendChild(meta);
    editorSubtaskList.appendChild(row);
  });
}

function getDependenciesForTask(taskId) {
  return (state.taskDependencies ?? []).filter(dep => dep.task_id === taskId);
}

function renderTaskEditorDependencies(task) {
  if (!editorDependencyList || !editorDependencyCount || !task) return;
  editorDependencyList.innerHTML = '';
  const deps = getDependenciesForTask(task.id);
  editorDependencyCount.textContent = `${deps.length}`;
  if (!deps.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No dependencies yet.';
    editorDependencyList.appendChild(empty);
    return;
  }
  deps.forEach(dep => {
    const depTask = state.tasks?.[dep.depends_on_id];
    const row = document.createElement('div');
    row.className = 'task-editor-dep-item';
    const title = document.createElement('span');
    title.className = 'task-editor-dep-title';
    title.textContent = depTask?.title ?? 'Unknown task';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-button task-editor-dep-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove dependency';
    removeBtn.addEventListener('click', async () => {
      await api.deleteTaskDependency(task.id, dep.depends_on_id);
      state.taskDependencies = (state.taskDependencies ?? [])
        .filter(item => !(item.task_id === task.id && item.depends_on_id === dep.depends_on_id));
      render();
    });
    row.appendChild(title);
    row.appendChild(removeBtn);
    editorDependencyList.appendChild(row);
  });
}

function populateDependencySelect(task) {
  if (!editorDependencySelect || !task) return;
  const existing = new Set(getDependenciesForTask(task.id).map(dep => dep.depends_on_id));
  editorDependencySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select task...';
  editorDependencySelect.appendChild(placeholder);
  Object.values(state.tasks ?? {})
    .filter(item => item.id !== task.id)
    .sort(compareTasksByPriority)
    .forEach(item => {
      if (existing.has(item.id)) return;
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      editorDependencySelect.appendChild(option);
    });
  editorDependencySelect.value = '';
}

function openTaskEditor(taskId) {
  const task = state.tasks[taskId];
  if (!task) return;
  const isOpen = taskEditor.classList.contains('is-open');
  if (isOpen && activeTaskId && activeTaskId !== taskId) {
    if (taskEditorAutosaveTimer) {
      clearTimeout(taskEditorAutosaveTimer);
      taskEditorAutosaveTimer = null;
    }
    void performTaskEditorAutosave({ force: true, taskId: activeTaskId });
    if (taskEditorSwapTimer) clearTimeout(taskEditorSwapTimer);
    taskEditor.classList.remove('is-open');
    taskEditorSwapTimer = setTimeout(() => {
      activeTaskId = taskId;
      populateTaskEditor(task);
      taskEditor.classList.add('is-open');
      taskEditorSwapTimer = null;
    }, 220);
    return;
  }
  if (taskEditorSwapTimer) {
    clearTimeout(taskEditorSwapTimer);
    taskEditorSwapTimer = null;
  }
  activeTaskId = taskId;
  populateTaskEditor(task);
  taskEditor.classList.add('is-open');
  updateTaskEditorScrollbar();
}

function closeTaskEditor() {
  if (taskEditorAutosaveTimer) {
    clearTimeout(taskEditorAutosaveTimer);
    taskEditorAutosaveTimer = null;
  }
  if (activeTaskId) {
    void performTaskEditorAutosave({ force: true, taskId: activeTaskId });
  }
  taskEditor.classList.remove('is-open');
  taskEditorScrollbar?.classList.add('hidden');
  if (taskEditorSwapTimer) {
    clearTimeout(taskEditorSwapTimer);
    taskEditorSwapTimer = null;
  }
  activeTaskId = null;
}

function closeTemplatePrompt() {
  templatePrompt?.classList.add('hidden');
  templatePromptTaskId = null;
}

async function dismissTemplatePrompt() {
  if (!templatePromptTaskId) return;
  await updateTaskRecord(templatePromptTaskId, { template_prompt_pending: 0 });
  closeTemplatePrompt();
  render();
}

async function advanceTemplateDate(template) {
  if (!template?.recurrence_interval || !template?.recurrence_unit || !template.next_event_date) {
    return;
  }
  const next = addInterval(new Date(template.next_event_date), Number(template.recurrence_interval), template.recurrence_unit);
  const updated = await api.updateTemplate(template.id, { next_event_date: next.toISOString().slice(0, 10) });
  if (updated) upsertTemplate(updated);
}

async function ensureTemplateReminders() {
  const templates = state.templates ?? [];
  const now = Date.now();
  for (const task of Object.values(state.tasks)) {
    if (task.template_state !== 'pending') continue;
    if (!task.template_defer_until) continue;
    const deferTime = new Date(task.template_defer_until).getTime();
    if (Number.isNaN(deferTime)) continue;
    if (now >= deferTime) {
      const updated = await api.updateTask(task.id, { template_prompt_pending: 1, template_defer_until: null });
      if (updated) upsertTask(updated);
    }
  }
  for (const template of templates) {
    if (template.archived) continue;
    if (template.workspace_id && template.workspace_id !== state.workspace.id) continue;
    if (!template.next_event_date) continue;
    const eventDate = new Date(`${template.next_event_date}T00:00:00`);
    if (Number.isNaN(eventDate.getTime())) continue;
    const leadDays = Number(template.lead_days ?? 0);
    const noticeAt = eventDate.getTime() - leadDays * 24 * 60 * 60 * 1000;
    if (now < noticeAt) continue;
    const existingReminder = Object.values(state.tasks).find(task =>
      task.template_id === template.id && task.template_state === 'pending'
    );
    if (existingReminder) continue;
    const reminderTask = await createTaskRecord({
      title: `Plan: ${template.name}`,
      status: getStatusKeyByKind(TaskStatus.INBOX) ?? getDefaultStatusKey(),
      priority: 'medium',
      project_id: template.project_id ?? null,
      type_label: 'Template Reminder',
      due_at: new Date(noticeAt).toISOString(),
      reminder_offset_days: 0,
      template_id: template.id,
      template_event_date: template.next_event_date,
      template_lead_days: leadDays,
      template_state: 'pending',
      template_prompt_pending: 1
    });
    if (reminderTask) upsertTask(reminderTask);
  }
}

async function startTemplatePlan(template) {
  const eventDate = template.next_event_date ? new Date(`${template.next_event_date}T00:00:00`) : null;
  const reminderTask = await createTaskRecord({
    title: `Plan: ${template.name}`,
    status: getStatusKeyByKind(TaskStatus.PLANNED) ?? getDefaultStatusKey(),
    priority: 'medium',
    project_id: template.project_id ?? null,
    type_label: template.name,
    due_at: eventDate ? eventDate.toISOString() : null,
    template_id: template.id,
    template_event_date: template.next_event_date ?? null,
    template_state: 'started'
  });
  if (reminderTask) {
    await generateTemplateSteps(template, reminderTask.id, eventDate);
  }
  if (template.recurrence_interval && template.recurrence_unit) {
    await advanceTemplateDate(template);
  }
}

async function startPlanFromReminder(task, template) {
  const eventDate = task.template_event_date ? new Date(`${task.template_event_date}T00:00:00`) : null;
  const updated = await updateTaskRecord(task.id, {
    status: getStatusKeyByKind(TaskStatus.PLANNED) ?? getDefaultStatusKey(),
    type_label: template.name,
    template_state: 'started',
    project_id: template.project_id ?? task.project_id ?? null,
    due_at: eventDate ? eventDate.toISOString() : task.due_at
  });
  if (updated) {
    await generateTemplateSteps(template, task.id, eventDate);
  }
  if (template.recurrence_interval && template.recurrence_unit) {
    await advanceTemplateDate(template);
  }
}

async function generateTemplateSteps(template, parentId, eventDate) {
  const steps = template.steps ?? [];
  if (!steps.length) return;
  const leadDays = Number(template.lead_days ?? 0);
  const eventTime = eventDate?.getTime();
  const spacing = leadDays && steps.length > 1 ? leadDays / (steps.length - 1) : 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    let dueAt = null;
    if (eventTime) {
      if (step.offset_days !== null && step.offset_days !== undefined) {
        dueAt = new Date(eventTime + step.offset_days * 24 * 60 * 60 * 1000);
      } else if (leadDays) {
        const offset = leadDays - index * spacing;
        dueAt = new Date(eventTime - offset * 24 * 60 * 60 * 1000);
      } else {
        dueAt = new Date(eventTime);
      }
    }
    await createTaskRecord({
      title: step.title,
      parent_id: parentId,
      status: getStatusKeyByKind(TaskStatus.PLANNED) ?? getDefaultStatusKey(),
      priority: 'medium',
      project_id: template.project_id ?? null,
      due_at: dueAt ? dueAt.toISOString() : null,
      type_label: template.name,
      template_id: template.id
    });
  }
}

async function maybePromptTemplate() {
  if (templatePromptTaskId) return;
  if (!templatePrompt) return;
  if (!state.workspace) return;
  const pending = Object.values(state.tasks).find(task =>
    task.workspace_id === state.workspace.id &&
    task.template_prompt_pending &&
    task.template_state === 'pending'
  );
  if (!pending) return;
  if (pending.template_defer_until) {
    const deferTime = new Date(pending.template_defer_until).getTime();
    if (!Number.isNaN(deferTime) && Date.now() < deferTime) return;
  }
  const template = (state.templates ?? []).find(t => t.id === pending.template_id);
  if (!template) {
    await updateTaskRecord(pending.id, { template_prompt_pending: 0 });
    return;
  }

  templatePromptTaskId = pending.id;
  templatePromptTitle.textContent = `Start planning: ${template.name}?`;
  const details = [];
  if (pending.template_event_date) details.push(`Event date: ${pending.template_event_date}`);
  if (template.lead_days) details.push(`Lead time: ${template.lead_days} days`);
  templatePromptText.textContent = details.join(' · ');
  templatePrompt.classList.remove('hidden');
}

function shouldNotify(task) {
  if (!task.due_at) return false;
  if (isDoneStatusKey(task.status) || isCanceledStatusKey(task.status)) return false;
  if (task.reminder_offset_days === null || task.reminder_offset_days === undefined) return false;
  const reminderMs = Number(task.reminder_offset_days) * 24 * 60 * 60 * 1000;
  if (Number.isNaN(reminderMs)) return false;
  const dueTime = new Date(task.due_at).getTime();
  if (Number.isNaN(dueTime)) return false;
  const reminderTime = dueTime - reminderMs;
  if (Date.now() < reminderTime) return false;
  if (task.reminder_sent_at) {
    const sentTime = new Date(task.reminder_sent_at).getTime();
    if (!Number.isNaN(sentTime) && sentTime >= reminderTime) return false;
  }
  return true;
}

function getNextNoticeNotifyAt(notice) {
  const rule = getNoticeRecurrenceRule(notice);
  if (!rule || !notice?.notify_at) return null;
  const base = new Date(notice.notify_at);
  if (Number.isNaN(base.getTime())) return null;
  const getEndBoundary = (value) => {
    if (value?.endType !== 'on' || !value.endDate) return null;
    const [year, month, day] = String(value.endDate).split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  };

  const getWeekStart = (date) => {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - value.getDay());
    return value;
  };

  const getNextFrom = (current) => {
    if (rule.unit !== 'week') {
      return addInterval(current, rule.interval, rule.unit);
    }
    const days = normalizeWeekdays(rule.weekdays);
    if (!days.length) {
      return addInterval(current, rule.interval, 'week');
    }
    const anchor = (() => {
      const anchorDate = rule.anchorDate ? new Date(rule.anchorDate) : null;
      return anchorDate && !Number.isNaN(anchorDate.getTime()) ? anchorDate : base;
    })();
    const anchorWeekStart = getWeekStart(anchor).getTime();
    for (let offset = 1; offset <= 3660; offset += 1) {
      const candidate = new Date(current.getTime());
      candidate.setDate(candidate.getDate() + offset);
      if (!days.includes(candidate.getDay())) continue;
      const weekDiff = Math.floor((getWeekStart(candidate).getTime() - anchorWeekStart) / (7 * 24 * 60 * 60 * 1000));
      if (weekDiff < 0) continue;
      if (weekDiff % rule.interval !== 0) continue;
      return candidate;
    }
    return null;
  };

  const endBoundary = getEndBoundary(rule);
  const isAllowed = (candidate, occurrenceIndex) => {
    if (!candidate || Number.isNaN(candidate.getTime())) return false;
    if (rule.endType === 'after' && Number(rule.endCount) > 0 && occurrenceIndex > Number(rule.endCount)) {
      return false;
    }
    if (endBoundary && candidate.getTime() > endBoundary.getTime()) return false;
    return true;
  };

  const currentCount = Number(notice.recurrence_occurrence_count ?? 0);
  let occurrenceIndex = Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 2 : 2;
  let next = getNextFrom(base);
  if (!isAllowed(next, occurrenceIndex)) return null;
  const now = Date.now();
  let guard = 0;
  while (next.getTime() <= now && guard < 1000) {
    next = getNextFrom(next);
    occurrenceIndex += 1;
    if (!isAllowed(next, occurrenceIndex)) return null;
    guard += 1;
  }
  return next;
}

function getNoticeOccurrencesInRange(notice, rangeStart, rangeEnd) {
  const startTime = rangeStart?.getTime?.();
  const endTime = rangeEnd?.getTime?.();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  const first = new Date(notice?.notify_at ?? '');
  if (Number.isNaN(first.getTime())) return [];
  const rule = getNoticeRecurrenceRule(notice);
  if (!rule) {
    const time = first.getTime();
    return time >= startTime && time <= endTime ? [first] : [];
  }

  const getEndBoundary = (value) => {
    if (value?.endType !== 'on' || !value.endDate) return null;
    const [year, month, day] = String(value.endDate).split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  };

  const getWeekStart = (date) => {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - value.getDay());
    return value;
  };

  const getNextFrom = (current) => {
    if (rule.unit !== 'week') {
      return addInterval(current, rule.interval, rule.unit);
    }
    const days = normalizeWeekdays(rule.weekdays);
    if (!days.length) {
      return addInterval(current, rule.interval, 'week');
    }
    const anchor = (() => {
      const anchorDate = rule.anchorDate ? new Date(rule.anchorDate) : null;
      return anchorDate && !Number.isNaN(anchorDate.getTime()) ? anchorDate : first;
    })();
    const anchorWeekStart = getWeekStart(anchor).getTime();
    for (let offset = 1; offset <= 3660; offset += 1) {
      const candidate = new Date(current.getTime());
      candidate.setDate(candidate.getDate() + offset);
      if (!days.includes(candidate.getDay())) continue;
      const weekDiff = Math.floor((getWeekStart(candidate).getTime() - anchorWeekStart) / (7 * 24 * 60 * 60 * 1000));
      if (weekDiff < 0) continue;
      if (weekDiff % rule.interval !== 0) continue;
      return candidate;
    }
    return null;
  };

  const endBoundary = getEndBoundary(rule);
  const isAllowed = (candidate, occurrenceIndex) => {
    if (!candidate || Number.isNaN(candidate.getTime())) return false;
    if (rule.endType === 'after' && Number(rule.endCount) > 0 && occurrenceIndex > Number(rule.endCount)) {
      return false;
    }
    if (endBoundary && candidate.getTime() > endBoundary.getTime()) return false;
    return true;
  };

  const occurrences = [];
  let current = first;
  let occurrenceIndex = Number(notice?.recurrence_occurrence_count ?? 0) + 1;
  if (!Number.isFinite(occurrenceIndex) || occurrenceIndex < 1) occurrenceIndex = 1;
  let guard = 0;

  while (guard < 8000) {
    if (!isAllowed(current, occurrenceIndex)) break;
    const currentTime = current.getTime();
    if (currentTime > endTime) break;
    if (currentTime >= startTime) {
      occurrences.push(new Date(currentTime));
    }
    const next = getNextFrom(current);
    const nextTime = next?.getTime?.();
    if (!Number.isFinite(nextTime) || nextTime <= currentTime) break;
    current = next;
    occurrenceIndex += 1;
    guard += 1;
  }

  return occurrences;
}

function getScheduleEventReminderMinutes(event) {
  const explicit = normalizeScheduleEventReminderOffsetMinutes(event?.reminder_offset_minutes);
  return explicit === null ? DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES : explicit;
}

function shouldNotifyActorForScheduleEvent(event) {
  const actorUserId = getAuthState().user?.id ?? null;
  const attendees = normalizeScheduleEventAttendeeUserIds(event?.attendee_user_ids);
  if (attendees.length) {
    return Boolean(actorUserId && attendees.includes(actorUserId));
  }
  const organizerUserId = String(event?.organizer_user_id ?? '').trim();
  if (organizerUserId) {
    return Boolean(actorUserId && actorUserId === organizerUserId);
  }
  return true;
}

function getNextScheduleEventReminderOccurrence(event, now = new Date()) {
  if (!event) return null;
  const nowTime = now.getTime();
  if (Number.isNaN(nowTime)) return null;
  const reminderMinutes = getScheduleEventReminderMinutes(event);
  const lookbackMs = 24 * 60 * 60 * 1000;
  const leadMs = reminderMinutes * 60 * 1000;
  const lookaheadMs = Math.max((24 * 60 * 60 * 1000), leadMs + (3 * 60 * 60 * 1000));
  const rangeStart = new Date(nowTime - lookbackMs);
  const rangeEnd = new Date(nowTime + lookaheadMs);
  const occurrences = getScheduleEventOccurrencesInRange(event, rangeStart, rangeEnd);
  const lastNotifiedOccurrence = String(event?.reminder_last_occurrence_at ?? '').trim();
  for (const occurrence of occurrences) {
    const occurrenceKey = occurrence.start.toISOString();
    if (lastNotifiedOccurrence && occurrenceKey === lastNotifiedOccurrence) continue;
    const notifyAt = occurrence.start.getTime() - leadMs;
    if (nowTime < notifyAt) continue;
    if (nowTime - notifyAt > lookbackMs) continue;
    return occurrence;
  }
  return null;
}

async function checkNotices() {
  if (!state.ui?.notificationsEnabled) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  for (const task of Object.values(state.tasks)) {
    if (!shouldNotify(task)) continue;
    new Notification('BrianHub Reminder', {
      body: `${task.title} is due soon.`,
      tag: task.id
    });
    appendAuditEvent({
      source: 'app',
      category: 'notification',
      event: 'task_reminder_sent',
      entity_type: 'task',
      entity_id: task.id
    });
    await updateTaskRecord(task.id, { reminder_sent_at: nowIso() });
  }
  for (const notice of state.notices ?? []) {
    if (!shouldNotifyNotice(notice)) continue;
    new Notification('BrianHub Notice', {
      body: notice.title,
      tag: notice.id
    });
    appendAuditEvent({
      source: 'app',
      category: 'notification',
      event: 'notice_sent',
      entity_type: 'notice',
      entity_id: notice.id
    });
    const recurrenceRule = getNoticeRecurrenceRule(notice);
    const nextNotifyAt = getNextNoticeNotifyAt(notice);
    const patch = { notice_sent_at: nowIso() };
    if (recurrenceRule) {
      patch.recurrence_occurrence_count = Number(notice.recurrence_occurrence_count ?? 0) + 1;
    }
    if (nextNotifyAt) patch.notify_at = nextNotifyAt.toISOString();
    await updateNoticeRecord(notice.id, patch);
  }
  const displayTimeZone = getSchedulingDisplayTimeZone();
  for (const event of getScheduleEventsForWorkspace()) {
    if (!shouldNotifyActorForScheduleEvent(event)) continue;
    const occurrence = getNextScheduleEventReminderOccurrence(event);
    if (!occurrence) continue;
    const isAllDay = Number(event?.all_day) === 1 || normalizeScheduleEventKind(event?.kind) === 'day-off';
    const startsLabel = isAllDay
      ? formatDateInTimeZone(occurrence.start, { month: 'short', day: 'numeric' }, displayTimeZone)
      : formatCalendarTimeLabel(occurrence.start, displayTimeZone);
    new Notification('BrianHub Event Reminder', {
      body: `${event.title} starts ${isAllDay ? `on ${startsLabel}` : `at ${startsLabel}`}.`,
      tag: `${event.id}:${occurrence.start.toISOString()}`
    });
    appendAuditEvent({
      source: 'app',
      category: 'notification',
      event: 'schedule_event_reminder_sent',
      entity_type: 'schedule_event',
      entity_id: event.id,
      data: {
        occurrence_start: occurrence.start.toISOString(),
        reminder_minutes: getScheduleEventReminderMinutes(event)
      }
    });
    updateScheduleEventRecord(event.id, {
      reminder_last_occurrence_at: occurrence.start.toISOString()
    });
  }
}

const timeZoneFormatterCache = new Map();

function getTimeZoneFormatter(timeZone, key, options) {
  const cacheKey = `${timeZone}::${key}`;
  if (timeZoneFormatterCache.has(cacheKey)) {
    return timeZoneFormatterCache.get(cacheKey);
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    hourCycle: 'h23',
    timeZone,
    ...options
  });
  timeZoneFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function getDateTimePartsInTimeZone(date, timeZone, options = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const includeSeconds = options.includeSeconds !== false;
  const includeWeekday = options.includeWeekday === true;
  const formatter = getTimeZoneFormatter(
    normalizeTimeZone(timeZone),
    `parts:${includeSeconds ? 's' : 'm'}:${includeWeekday ? 'w' : 'n'}`,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      ...(includeWeekday ? { weekday: 'short' } : {})
    }
  );
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type === 'literal') return;
    map[part.type] = part.value;
  });
  const parsed = {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: includeSeconds ? Number(map.second ?? 0) : 0,
    weekday: includeWeekday ? String(map.weekday ?? '') : ''
  };
  if (!Number.isFinite(parsed.year) || !Number.isFinite(parsed.month) || !Number.isFinite(parsed.day)) return null;
  if (!Number.isFinite(parsed.hour) || !Number.isFinite(parsed.minute) || !Number.isFinite(parsed.second)) return null;
  return parsed;
}

function formatDateInTimeZone(date, options = {}, timeZone = getSchedulingDisplayTimeZone()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { ...options, timeZone: normalizeTimeZone(timeZone) });
}

function formatDateTimeInTimeZone(date, options = {}, timeZone = getSchedulingDisplayTimeZone()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { ...options, timeZone: normalizeTimeZone(timeZone) });
}

function getDateKeyInTimeZone(date, timeZone = getSchedulingDisplayTimeZone()) {
  const parts = getDateTimePartsInTimeZone(date, timeZone, { includeSeconds: false });
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getMinutesInDayInTimeZone(date, timeZone = getSchedulingDisplayTimeZone()) {
  const parts = getDateTimePartsInTimeZone(date, timeZone, { includeSeconds: false });
  if (!parts) return 0;
  return (parts.hour * 60) + parts.minute;
}

function getTimeZoneOffsetMinutesForInstant(date, timeZone) {
  const parts = getDateTimePartsInTimeZone(date, timeZone, { includeSeconds: true });
  if (!parts) return -date.getTimezoneOffset();
  const utcFromParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return Math.round((utcFromParts - date.getTime()) / 60000);
}

function parseDatetimeLocalValue(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { year, month, day, hour, minute };
}

function getUtcDateForTimeZoneParts(year, month, day, hour, minute, timeZone = getSchedulingDisplayTimeZone()) {
  const tz = normalizeTimeZone(timeZone);
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcMs = baseUtcMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getTimeZoneOffsetMinutesForInstant(new Date(utcMs), tz);
    const nextUtcMs = baseUtcMs - (offset * 60 * 1000);
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }
  return new Date(utcMs);
}

function fromDatetimeLocalInTimeZone(value, timeZone = getSchedulingDisplayTimeZone()) {
  const parsed = parseDatetimeLocalValue(value);
  if (!parsed) return null;
  const utcDate = getUtcDateForTimeZoneParts(
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    timeZone
  );
  if (Number.isNaN(utcDate.getTime())) return null;
  return utcDate.toISOString();
}

function toDatetimeLocalInTimeZone(iso, timeZone = getSchedulingDisplayTimeZone()) {
  if (!iso) return '';
  const date = new Date(iso);
  const parts = getDateTimePartsInTimeZone(date, timeZone, { includeSeconds: false });
  if (!parts) return '';
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toDateInputValueInTimeZone(iso, timeZone = getSchedulingDisplayTimeZone()) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return getDateKeyInTimeZone(date, timeZone);
}

function fromDateInputValueInTimeZone(value, timeZone = getSchedulingDisplayTimeZone()) {
  const parsed = parseDateOnlyValue(value);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  const utcDate = getUtcDateForTimeZoneParts(year, month, day, 0, 0, timeZone);
  if (Number.isNaN(utcDate.getTime())) return null;
  return utcDate.toISOString();
}

function addDaysToDateKey(dateKey, deltaDays) {
  const parsed = parseDateOnlyValue(dateKey);
  if (!parsed) return dateKey;
  parsed.setDate(parsed.getDate() + Number(deltaDays || 0));
  return formatDateOnlyValue(parsed);
}

function getDayDeltaBetweenDateKeys(fromKey, toKey) {
  const from = parseDateOnlyValue(fromKey);
  const to = parseDateOnlyValue(toKey);
  if (!from || !to) return 0;
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

function getTimedEventEndDateKey(endDate, startDate, timeZone = getSchedulingDisplayTimeZone()) {
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return '';
  const startMs = startDate instanceof Date && !Number.isNaN(startDate.getTime())
    ? startDate.getTime()
    : null;
  if (startMs !== null && endDate.getTime() > startMs) {
    // Treat end as exclusive so events ending exactly at 12:00 AM stay in the prior day.
    return getDateKeyInTimeZone(new Date(endDate.getTime() - 1), timeZone);
  }
  return getDateKeyInTimeZone(endDate, timeZone);
}

function listDateKeysBetween(startKey, endKey) {
  const start = parseDateOnlyValue(startKey);
  const end = parseDateOnlyValue(endKey);
  if (!start || !end) return [];
  const keys = [];
  const cursor = new Date(start.getTime());
  const direction = cursor.getTime() <= end.getTime() ? 1 : -1;
  while ((direction > 0 && cursor.getTime() <= end.getTime()) || (direction < 0 && cursor.getTime() >= end.getTime())) {
    keys.push(formatDateOnlyValue(cursor));
    cursor.setDate(cursor.getDate() + direction);
  }
  return keys;
}

function toDatetimeLocal(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toDateInputValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateOnlyValue(date);
}

function fromDateInputValue(value) {
  const date = parseDateOnlyValue(value);
  if (!date) return null;
  return date.toISOString();
}

function normalizeScheduleEventFormKind(kind) {
  return normalizeScheduleEventKind(kind);
}

function populateScheduleEventCalendarSelect(selectedId = null) {
  if (!scheduleEventCalendar) return null;
  const calendars = getScheduleCalendarsForWorkspace();
  scheduleEventCalendar.innerHTML = '';
  if (!calendars.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No calendars';
    scheduleEventCalendar.appendChild(option);
    scheduleEventCalendar.disabled = true;
    scheduleEventCalendar.value = '';
    return null;
  }
  calendars.forEach((calendar) => {
    const option = document.createElement('option');
    option.value = calendar.id;
    option.textContent = calendar.name;
    scheduleEventCalendar.appendChild(option);
  });
  scheduleEventCalendar.disabled = false;
  const requestedId = String(selectedId ?? '').trim();
  const resolvedId = calendars.some((calendar) => calendar.id === requestedId)
    ? requestedId
    : getActiveScheduleCalendarId() ?? calendars[0].id;
  scheduleEventCalendar.value = resolvedId;
  return resolvedId;
}

function populateScheduleEventTypeSelect(selectedId = null) {
  if (!scheduleEventType) return null;
  const types = getScheduleEventTypesForWorkspace();
  scheduleEventType.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  scheduleEventType.appendChild(noneOption);
  types.forEach((type) => {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.name;
    scheduleEventType.appendChild(option);
  });
  const requested = String(selectedId ?? '').trim();
  if (requested && types.some((type) => type.id === requested)) {
    scheduleEventType.value = requested;
    return requested;
  }
  scheduleEventType.value = '';
  return null;
}

function populateScheduleEventAttendeeSelect(selectedIds = []) {
  if (!scheduleEventAttendees) return;
  const users = getUsersForCurrentWorkspace();
  const normalizedSelected = normalizeScheduleEventAttendeeUserIds(selectedIds);
  scheduleEventAttendees.innerHTML = '';
  users.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    const email = String(user.email ?? '').trim();
    option.textContent = email ? `${user.display_name} · ${email}` : user.display_name;
    option.selected = normalizedSelected.includes(user.id);
    scheduleEventAttendees.appendChild(option);
  });
  normalizedSelected
    .filter((userId) => !users.some((user) => user.id === userId))
    .forEach((userId) => {
      const option = document.createElement('option');
      option.value = userId;
      option.textContent = `Unknown user (${userId.slice(0, 8)})`;
      option.selected = true;
      scheduleEventAttendees.appendChild(option);
    });
  if (!users.length && !normalizedSelected.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No users available';
    option.disabled = true;
    option.selected = true;
    scheduleEventAttendees.appendChild(option);
  }
}

function getSelectedScheduleEventAttendeeUserIds() {
  if (!scheduleEventAttendees) return [];
  const selectedIds = Array.from(scheduleEventAttendees.selectedOptions ?? [])
    .map((option) => String(option.value ?? '').trim())
    .filter(Boolean);
  return normalizeScheduleEventAttendeeUserIds(selectedIds);
}

const SCHEDULE_EVENT_DESCRIPTION_ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'P', 'BR'
]);

function sanitizeScheduleEventDescriptionHtml(value) {
  const container = document.createElement('div');
  container.innerHTML = String(value ?? '');
  const scrub = (node) => {
    Array.from(node.childNodes ?? []).forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child;
      const tag = element.tagName?.toUpperCase?.() ?? '';
      if (!SCHEDULE_EVENT_DESCRIPTION_ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (element.firstChild) {
          fragment.appendChild(element.firstChild);
        }
        element.replaceWith(fragment);
        scrub(node);
        return;
      }
      if (tag === 'A') {
        const href = String(element.getAttribute('href') ?? '').trim();
        const isAllowedHref = /^(https?:\/\/|mailto:|tel:)/i.test(href);
        if (isAllowedHref) {
          element.setAttribute('href', href);
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        } else {
          element.removeAttribute('href');
          element.removeAttribute('target');
          element.removeAttribute('rel');
        }
      }
      Array.from(element.attributes ?? []).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const keepAttribute = tag === 'A' && (name === 'href' || name === 'target' || name === 'rel');
        if (!keepAttribute) {
          element.removeAttribute(attribute.name);
        }
      });
      scrub(element);
    });
  };
  scrub(container);
  return container.innerHTML.trim();
}

function setScheduleEventDescriptionPlaceholder(value) {
  if (!scheduleEventDescription) return;
  scheduleEventDescription.dataset.placeholder = String(value ?? '').trim() || 'Optional description';
}

function getScheduleEventDescriptionText() {
  if (scheduleEventDescription) {
    const rawText = typeof scheduleEventDescription.innerText === 'string'
      ? scheduleEventDescription.innerText
      : scheduleEventDescription.textContent;
    return String(rawText ?? '').trim();
  }
  return String(scheduleEventNotes?.value ?? '').trim();
}

function getScheduleEventDescriptionValue() {
  if (scheduleEventDescription) {
    const sanitizedHtml = sanitizeScheduleEventDescriptionHtml(scheduleEventDescription.innerHTML);
    const hasFormatting = /<(strong|b|em|i|u|a|ul|ol|li|p|br)\b/i.test(sanitizedHtml);
    if (!sanitizedHtml) return '';
    return hasFormatting ? sanitizedHtml : getScheduleEventDescriptionText();
  }
  return String(scheduleEventNotes?.value ?? '');
}

function syncScheduleEventDescriptionHiddenField() {
  if (!scheduleEventNotes) return;
  scheduleEventNotes.value = getScheduleEventDescriptionValue();
}

function setScheduleEventDescriptionValue(value) {
  if (!scheduleEventDescription) {
    if (scheduleEventNotes) scheduleEventNotes.value = String(value ?? '');
    return;
  }
  const raw = String(value ?? '').trim();
  if (!raw) {
    scheduleEventDescription.innerHTML = '';
    syncScheduleEventDescriptionHiddenField();
    return;
  }
  const looksLikeHtml = /<[^>]+>/.test(raw);
  if (looksLikeHtml) {
    scheduleEventDescription.innerHTML = sanitizeScheduleEventDescriptionHtml(raw);
  } else {
    scheduleEventDescription.textContent = raw;
  }
  syncScheduleEventDescriptionHiddenField();
}

function runScheduleEventDescriptionCommand(command) {
  if (!scheduleEventDescription || scheduleEventModalMode === 'view') return;
  scheduleEventDescription.focus();
  if (command === 'link') {
    const currentHref = document.getSelection?.()?.anchorNode?.parentElement?.closest?.('a')?.getAttribute?.('href') ?? '';
    const response = prompt('Enter URL', currentHref || 'https://');
    if (response === null) return;
    const href = String(response).trim();
    if (!href) {
      document.execCommand('unlink');
      syncScheduleEventDescriptionHiddenField();
      return;
    }
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
      alert('Use a valid URL (http/https) or mailto/tel link.');
      return;
    }
    document.execCommand('createLink', false, href);
    const selectedLink = document.getSelection?.()?.anchorNode?.parentElement?.closest?.('a');
    if (selectedLink) {
      selectedLink.setAttribute('target', '_blank');
      selectedLink.setAttribute('rel', 'noopener noreferrer');
    }
    syncScheduleEventDescriptionHiddenField();
    return;
  }
  const commandMap = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    bullet: 'insertUnorderedList',
    ordered: 'insertOrderedList'
  };
  const nativeCommand = commandMap[command];
  if (!nativeCommand) return;
  document.execCommand(nativeCommand, false, null);
  syncScheduleEventDescriptionHiddenField();
}

function bindScheduleEventDescriptionEditor() {
  if (bindScheduleEventDescriptionEditor.bound) return;
  bindScheduleEventDescriptionEditor.bound = true;
  if (scheduleEventDescription) {
    scheduleEventDescription.addEventListener('input', () => {
      syncScheduleEventDescriptionHiddenField();
    });
    scheduleEventDescription.addEventListener('blur', () => {
      scheduleEventDescription.innerHTML = sanitizeScheduleEventDescriptionHtml(scheduleEventDescription.innerHTML);
      syncScheduleEventDescriptionHiddenField();
    });
  }
  scheduleEventDescriptionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      runScheduleEventDescriptionCommand(button.dataset.command ?? '');
    });
  });
}
bindScheduleEventDescriptionEditor.bound = false;

function syncScheduleEventDescriptionTemplate(options = {}) {
  const preserveValue = options.preserveValue !== false;
  if (!scheduleEventType) return;
  const selectedTypeId = String(scheduleEventType.value ?? '').trim();
  const selectedType = getScheduleEventTypeById(selectedTypeId);
  const template = String(selectedType?.description_template ?? '');
  setScheduleEventDescriptionPlaceholder(template || 'Optional description');
  if (!preserveValue) return;
  if (!getScheduleEventDescriptionText() && template) {
    setScheduleEventDescriptionValue(template);
  }
}

function renderScheduleEventColorPresets() {
  if (!scheduleEventColorPresets || !scheduleEventColor) return;
  const activeColor = normalizeScheduleEventColor(scheduleEventColor.value) ?? SCHEDULE_EVENT_COLOR_PRESET_PALETTE[0];
  const normalizedPresetColors = SCHEDULE_EVENT_COLOR_PRESET_PALETTE
    .map((color) => normalizeScheduleEventColor(color))
    .filter(Boolean);
  const isReadOnly = scheduleEventModalMode === 'view';
  const activePresetSet = new Set(normalizedPresetColors);
  const isCustomActive = !activePresetSet.has(activeColor);

  scheduleEventColorPresets.innerHTML = '';

  normalizedPresetColors.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `schedule-event-color-chip${color === activeColor ? ' is-active' : ''}`;
    button.dataset.color = color;
    button.style.backgroundColor = color;
    button.title = color;
    button.setAttribute('aria-label', `Select ${color}`);
    button.disabled = isReadOnly;
    button.addEventListener('click', () => {
      if (scheduleEventModalMode === 'view') return;
      if (scheduleEventColorOverride && !scheduleEventColorOverride.checked) {
        scheduleEventColorOverride.checked = true;
      }
      scheduleEventColor.value = color;
      syncScheduleEventColorInputs();
    });
    scheduleEventColorPresets.appendChild(button);
  });

  const customButton = document.createElement('button');
  customButton.type = 'button';
  customButton.className = `schedule-event-color-chip schedule-event-color-chip-custom${isCustomActive ? ' is-active' : ''}`;
  customButton.title = 'Custom color';
  customButton.setAttribute('aria-label', 'Pick a custom color');
  customButton.disabled = isReadOnly;
  customButton.addEventListener('click', () => {
    if (scheduleEventModalMode === 'view') return;
    if (scheduleEventColorOverride && !scheduleEventColorOverride.checked) {
      scheduleEventColorOverride.checked = true;
    }
    scheduleEventColor.disabled = false;
    scheduleEventColor.click();
  });
  scheduleEventColorPresets.appendChild(customButton);
}

function syncScheduleEventColorInputs() {
  if (!scheduleEventColor || !scheduleEventColorOverride) return;
  const overrideEnabled = Boolean(scheduleEventColorOverride.checked);
  if (!overrideEnabled) {
    const selectedTypeId = String(scheduleEventType?.value ?? '').trim() || null;
    const selectedCalendarId = String(scheduleEventCalendar?.value ?? '').trim() || null;
    const calendarColor = getScheduleCalendarById(selectedCalendarId)?.color ?? null;
    const nextColor = getResolvedScheduleEventColor(
      {
        color_override: null,
        event_type_id: selectedTypeId
      },
      calendarColor
    );
    scheduleEventColor.value = nextColor;
  } else if (!normalizeScheduleEventColor(scheduleEventColor.value)) {
    scheduleEventColor.value = SCHEDULE_CALENDAR_COLOR_PALETTE[0];
  }
  scheduleEventColor.disabled = !overrideEnabled;
  renderScheduleEventColorPresets();
}

function syncScheduleEventRepeatInputs() {
  if (!scheduleEventRepeatUnit || !scheduleEventRepeatInterval) return;
  const unit = normalizeScheduleEventRecurrenceUnit(scheduleEventRepeatUnit.value);
  const hasRepeat = Boolean(unit);
  scheduleEventRepeatInterval.disabled = !hasRepeat;
  if (!hasRepeat) {
    scheduleEventRepeatInterval.value = '';
    return;
  }
  const interval = normalizeScheduleEventRecurrenceInterval(scheduleEventRepeatInterval.value);
  if (!interval) {
    scheduleEventRepeatInterval.value = '1';
  }
}

function syncScheduleEventDatetimeInputs() {
  if (!scheduleEventStart || !scheduleEventEnd || !scheduleEventAllDay) return;
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const allDay = Boolean(scheduleEventAllDay.checked);
  const nextType = allDay ? 'date' : 'datetime-local';
  const startValue = scheduleEventStart.value;
  const endValue = scheduleEventEnd.value;
  if (scheduleEventStart.type !== nextType) {
    scheduleEventStart.type = nextType;
    scheduleEventStart.value = allDay
      ? toDateInputValueInTimeZone(fromDatetimeLocalInTimeZone(startValue, displayTimeZone), displayTimeZone)
      : toDatetimeLocalInTimeZone(fromDateInputValueInTimeZone(startValue, displayTimeZone), displayTimeZone);
  }
  if (scheduleEventEnd.type !== nextType) {
    scheduleEventEnd.type = nextType;
    scheduleEventEnd.value = allDay
      ? toDateInputValueInTimeZone(fromDatetimeLocalInTimeZone(endValue, displayTimeZone), displayTimeZone)
      : toDatetimeLocalInTimeZone(fromDateInputValueInTimeZone(endValue, displayTimeZone), displayTimeZone);
  }
}

function setScheduleEventFormDisabled(disabled) {
  const fields = [
    scheduleEventTitle,
    scheduleEventCalendar,
    scheduleEventKind,
    scheduleEventType,
    scheduleEventColorOverride,
    scheduleEventColor,
    scheduleEventAllDay,
    scheduleEventRepeatInterval,
    scheduleEventRepeatUnit,
    scheduleEventStart,
    scheduleEventEnd,
    scheduleEventReminder,
    scheduleEventAttendees,
    scheduleEventNotes
  ];
  fields.forEach((field) => {
    if (!field) return;
    field.disabled = Boolean(disabled);
  });
  if (scheduleEventDescriptionEditor) {
    scheduleEventDescriptionEditor.classList.toggle('is-readonly', Boolean(disabled));
  }
  if (scheduleEventDescription) {
    scheduleEventDescription.contentEditable = disabled ? 'false' : 'true';
  }
  scheduleEventDescriptionButtons.forEach((button) => {
    button.disabled = Boolean(disabled);
  });
  if (scheduleEventColorPresets) {
    scheduleEventColorPresets.classList.toggle('is-disabled', Boolean(disabled));
    scheduleEventColorPresets.querySelectorAll('button').forEach((button) => {
      button.disabled = Boolean(disabled);
    });
  }
  if (scheduleEventColor && !scheduleEventColorOverride?.checked) {
    scheduleEventColor.disabled = true;
  }
}

function getScheduleEventKindLabel(kind) {
  const normalized = normalizeScheduleEventKind(kind);
  if (normalized === 'time-block') return 'Time Block';
  if (normalized === 'day-off') return 'Day Off';
  return 'Event';
}

function getScheduleEventRepeatSummary(interval, unit) {
  const normalizedInterval = normalizeScheduleEventRecurrenceInterval(interval);
  const normalizedUnit = normalizeScheduleEventRecurrenceUnit(unit);
  if (!normalizedInterval || !normalizedUnit) return 'Does not repeat';
  const unitLabel = normalizedInterval === 1 ? normalizedUnit : `${normalizedUnit}s`;
  return `Repeats every ${normalizedInterval} ${unitLabel}`;
}

function formatScheduleEventWhenSummary({ startAt, endAt, allDay, displayTimeZone }) {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return 'Not set';
  if (allDay) {
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
      return formatDateInTimeZone(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone);
    }
    const startKey = getDateKeyInTimeZone(start, displayTimeZone);
    const endKey = getDateKeyInTimeZone(end, displayTimeZone);
    if (startKey === endKey) {
      return formatDateInTimeZone(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone);
    }
    return `${formatDateInTimeZone(start, { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)} - ${formatDateInTimeZone(end, { month: 'short', day: 'numeric', year: 'numeric' }, displayTimeZone)}`;
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    return formatDateTimeInTimeZone(
      start,
      { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
      displayTimeZone
    );
  }
  const startKey = getDateKeyInTimeZone(start, displayTimeZone);
  const endKey = getDateKeyInTimeZone(end, displayTimeZone);
  if (startKey === endKey) {
    return `${formatDateTimeInTimeZone(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, displayTimeZone)} - ${formatCalendarTimeLabel(end, displayTimeZone)}`;
  }
  return `${formatDateTimeInTimeZone(start, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, displayTimeZone)} - ${formatDateTimeInTimeZone(end, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, displayTimeZone)}`;
}

function printScheduleEventFromModal() {
  if (!activeScheduleEventId) return;
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const title = normalizeTitleInput(scheduleEventTitle?.value ?? '') || 'Untitled event';
  const calendarId = String(scheduleEventCalendar?.value ?? '').trim() || null;
  const calendar = calendarId ? getScheduleCalendarById(calendarId, { includeArchived: true }) : null;
  const calendarName = String(calendar?.name ?? 'Unknown calendar');
  const calendarTimeZone = normalizeTimeZone(calendar?.time_zone ?? displayTimeZone);
  const kind = normalizeScheduleEventFormKind(scheduleEventKind?.value ?? 'event');
  const kindLabel = getScheduleEventKindLabel(kind);
  const typeLabel = String(scheduleEventType?.selectedOptions?.[0]?.textContent ?? '').trim() || 'None';
  const allDay = Boolean(scheduleEventAllDay?.checked) || kind === 'day-off';
  const startAt = allDay
    ? fromDateInputValueInTimeZone(scheduleEventStart?.value ?? '', displayTimeZone)
    : fromDatetimeLocalInTimeZone(scheduleEventStart?.value ?? '', displayTimeZone);
  const endAtInput = allDay
    ? fromDateInputValueInTimeZone(scheduleEventEnd?.value ?? '', displayTimeZone)
    : fromDatetimeLocalInTimeZone(scheduleEventEnd?.value ?? '', displayTimeZone);
  const endAt = endAtInput || startAt;
  const whenSummary = formatScheduleEventWhenSummary({
    startAt,
    endAt,
    allDay,
    displayTimeZone
  });
  const repeatSummary = getScheduleEventRepeatSummary(
    scheduleEventRepeatInterval?.value ?? null,
    scheduleEventRepeatUnit?.value ?? null
  );
  const reminderMinutes = normalizeScheduleEventReminderOffsetMinutes(scheduleEventReminder?.value ?? '');
  const reminderSummary = reminderMinutes === null
    ? `${DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES} minutes before`
    : `${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'} before`;
  const attendeeLabels = Array.from(scheduleEventAttendees?.selectedOptions ?? [])
    .map((option) => String(option.textContent ?? '').trim())
    .filter(Boolean);
  const descriptionValue = getScheduleEventDescriptionValue();
  const descriptionHtml = /<[^>]+>/.test(descriptionValue)
    ? sanitizeScheduleEventDescriptionHtml(descriptionValue)
    : escapeHtmlText(descriptionValue).replace(/\n/g, '<br />');
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720');
  if (!popup) {
    alert('Unable to open print preview. Please allow pop-ups for this site.');
    return;
  }
  const safeTitle = escapeHtmlText(title);
  const safeCalendarName = escapeHtmlText(calendarName);
  const safeKindLabel = escapeHtmlText(kindLabel);
  const safeTypeLabel = escapeHtmlText(typeLabel);
  const safeWhenSummary = escapeHtmlText(whenSummary);
  const safeRepeatSummary = escapeHtmlText(repeatSummary);
  const safeReminderSummary = escapeHtmlText(reminderSummary);
  const safeDisplayTimeZone = escapeHtmlText(displayTimeZone);
  const safeCalendarTimeZone = escapeHtmlText(calendarTimeZone);
  const attendeesHtml = attendeeLabels.length
    ? attendeeLabels.map((label) => `<li>${escapeHtmlText(label)}</li>`).join('')
    : '<li>None</li>';
  const renderedDescription = descriptionHtml || '<em>No description</em>';
  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Print Event - ${safeTitle}</title>
    <style>
      body { margin: 0; padding: 24px; color: #0f172a; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      .meta { color: #475569; margin-bottom: 18px; font-size: 12px; }
      .grid { display: grid; grid-template-columns: 180px 1fr; gap: 10px 14px; margin-bottom: 18px; }
      .label { color: #475569; font-weight: 600; }
      .value { color: #0f172a; }
      ul { margin: 0; padding-left: 18px; }
      .desc { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; line-height: 1.45; }
      .desc p { margin: 0 0 8px; }
      .desc p:last-child { margin-bottom: 0; }
      @media print { body { padding: 12mm; } }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <div class="meta">BrianHub calendar event</div>
    <div class="grid">
      <div class="label">Calendar</div><div class="value">${safeCalendarName}</div>
      <div class="label">Type</div><div class="value">${safeKindLabel}</div>
      <div class="label">Event type</div><div class="value">${safeTypeLabel}</div>
      <div class="label">When</div><div class="value">${safeWhenSummary}</div>
      <div class="label">All day</div><div class="value">${allDay ? 'Yes' : 'No'}</div>
      <div class="label">Repeat</div><div class="value">${safeRepeatSummary}</div>
      <div class="label">Reminder</div><div class="value">${safeReminderSummary}</div>
      <div class="label">Display time zone</div><div class="value">${safeDisplayTimeZone}</div>
      <div class="label">Calendar time zone</div><div class="value">${safeCalendarTimeZone}</div>
      <div class="label">Attendees</div><div class="value"><ul>${attendeesHtml}</ul></div>
    </div>
    <div class="label" style="margin-bottom: 6px;">Description</div>
    <div class="desc">${renderedDescription}</div>
  </body>
</html>`);
  popup.document.close();
  popup.focus();
  setTimeout(() => {
    try {
      popup.print();
    } catch {
      // no-op
    }
  }, 120);
}

function setScheduleEventModalMode(mode = 'create') {
  scheduleEventModalMode = mode === 'view' || mode === 'edit' ? mode : 'create';
  const isView = scheduleEventModalMode === 'view';
  const isEdit = scheduleEventModalMode === 'edit';
  const hasExistingEvent = Boolean(activeScheduleEventId);

  setScheduleEventFormDisabled(isView);

  if (scheduleEventModalTitle) {
    if (!hasExistingEvent) {
      scheduleEventModalTitle.textContent = 'New event';
    } else if (isView) {
      scheduleEventModalTitle.textContent = 'Event details';
    } else {
      scheduleEventModalTitle.textContent = 'Edit event';
    }
  }

  if (scheduleEventEdit) {
    scheduleEventEdit.classList.toggle('hidden', !hasExistingEvent || !isView);
  }
  if (scheduleEventSave) {
    scheduleEventSave.classList.toggle('hidden', isView);
    scheduleEventSave.textContent = hasExistingEvent ? 'Save' : 'Create';
  }
  if (scheduleEventDelete) {
    scheduleEventDelete.classList.toggle('hidden', !hasExistingEvent || isView);
  }
  if (scheduleEventPrint) {
    scheduleEventPrint.classList.toggle('hidden', !hasExistingEvent);
  }
  if (scheduleEventCancel) {
    scheduleEventCancel.textContent = isView ? 'Close' : 'Cancel';
  }
}

function openScheduleEventModal(event = null, defaults = {}, options = {}) {
  activeScheduleEventId = event?.id ?? null;
  const requestedMode = String(options?.mode ?? '').trim();
  const nextMode = activeScheduleEventId
    ? (requestedMode === 'edit' ? 'edit' : 'view')
    : 'create';
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const startAt = defaults.start_at ?? event?.start_at ?? nowIso();
  const endAt = defaults.end_at ?? event?.end_at ?? null;
  const allDay = defaults.all_day ?? event?.all_day ?? false;
  const calendarId = defaults.calendar_id ?? event?.calendar_id ?? getActiveScheduleCalendarId();
  const defaultTypeId = !event ? (getScheduleEventTypesForWorkspace()[0]?.id ?? null) : null;
  const eventTypeId = defaults.event_type_id ?? event?.event_type_id ?? defaultTypeId;
  const attendeeUserIds = defaults.attendee_user_ids ?? event?.attendee_user_ids ?? [];
  const reminderOffsetMinutes = normalizeScheduleEventReminderOffsetMinutes(
    defaults.reminder_offset_minutes ?? event?.reminder_offset_minutes
  );
  const recurrenceInterval = defaults.recurrence_interval ?? event?.recurrence_interval ?? null;
  const recurrenceUnit = defaults.recurrence_unit ?? event?.recurrence_unit ?? '';
  if (scheduleEventTitle) {
    scheduleEventTitle.value = event?.title ?? defaults.title ?? '';
  }
  const resolvedCalendarId = populateScheduleEventCalendarSelect(calendarId);
  if (resolvedCalendarId) {
    setActiveScheduleCalendarId(resolvedCalendarId);
  }
  if (scheduleEventKind) {
    scheduleEventKind.value = normalizeScheduleEventFormKind(event?.kind ?? defaults.kind ?? 'event');
  }
  populateScheduleEventTypeSelect(eventTypeId);
  if (scheduleEventColorOverride) {
    scheduleEventColorOverride.checked = Boolean(normalizeScheduleEventColor(defaults.color_override ?? event?.color_override));
  }
  if (scheduleEventColor) {
    scheduleEventColor.value = getResolvedScheduleEventColor(
      {
        color_override: defaults.color_override ?? event?.color_override ?? null,
        event_type_id: eventTypeId
      },
      getScheduleCalendarById(resolvedCalendarId)?.color ?? null
    );
  }
  populateScheduleEventAttendeeSelect(attendeeUserIds);
  if (scheduleEventAllDay) {
    scheduleEventAllDay.checked = Boolean(allDay);
  }
  if (scheduleEventRepeatUnit) {
    scheduleEventRepeatUnit.value = normalizeScheduleEventRecurrenceUnit(recurrenceUnit) ?? '';
  }
  if (scheduleEventRepeatInterval) {
    const normalizedRepeat = normalizeScheduleEventRecurrenceInterval(recurrenceInterval);
    scheduleEventRepeatInterval.value = normalizedRepeat ? String(normalizedRepeat) : '';
  }
  syncScheduleEventRepeatInputs();
  syncScheduleEventDatetimeInputs();
  if (scheduleEventStart) {
    scheduleEventStart.value = scheduleEventAllDay?.checked
      ? toDateInputValueInTimeZone(startAt, displayTimeZone)
      : toDatetimeLocalInTimeZone(startAt, displayTimeZone);
  }
  if (scheduleEventEnd) {
    scheduleEventEnd.value = scheduleEventAllDay?.checked
      ? toDateInputValueInTimeZone(endAt, displayTimeZone)
      : toDatetimeLocalInTimeZone(endAt, displayTimeZone);
  }
  setScheduleEventDescriptionValue(event?.notes ?? defaults.notes ?? '');
  if (scheduleEventReminder) {
    scheduleEventReminder.value = String(
      reminderOffsetMinutes === null
        ? DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES
        : reminderOffsetMinutes
    );
  }
  syncScheduleEventDescriptionTemplate({ preserveValue: true });
  syncScheduleEventDescriptionHiddenField();
  syncScheduleEventColorInputs();
  setScheduleEventModalMode(nextMode);
  scheduleEventModal?.classList.remove('hidden');
  if (nextMode === 'view' && scheduleEventEdit) {
    scheduleEventEdit.focus();
  } else {
    scheduleEventTitle?.focus();
  }
}

function closeScheduleEventModal() {
  scheduleEventModal?.classList.add('hidden');
  activeScheduleEventId = null;
  scheduleEventModalMode = 'create';
  setScheduleEventFormDisabled(false);
}

function openScheduleEventCreate(kind = 'event') {
  const normalizedKind = normalizeScheduleEventFormKind(kind);
  const now = new Date();
  const isDayOff = normalizedKind === 'day-off';
  const startAt = now.toISOString();
  const durationMs = getSchedulingDefaultEventDurationMinutes() * 60 * 1000;
  const endAt = isDayOff ? startAt : new Date(now.getTime() + durationMs).toISOString();
  const defaultEventTypeId = getScheduleEventTypesForWorkspace()[0]?.id ?? null;
  openScheduleEventModal(null, {
    title: '',
    kind: normalizedKind,
    calendar_id: getActiveScheduleCalendarId(),
    event_type_id: defaultEventTypeId,
    all_day: isDayOff,
    start_at: startAt,
    end_at: endAt,
    notes: ''
  }, { mode: 'create' });
}

function getScheduleEventRecordById(eventId) {
  const id = String(eventId ?? '').trim();
  if (!id) return null;
  return (state.scheduleEvents ?? []).find((event) => event.id === id) ?? null;
}

function getScheduleEventDraftFromRecord(eventRecord) {
  if (!eventRecord) return null;
  const event = normalizeScheduleEvent(eventRecord);
  const fallbackCalendarId = resolveScheduleCalendarId(event.calendar_id) ?? getActiveScheduleCalendarId();
  return {
    title: event.title,
    calendar_id: fallbackCalendarId,
    event_type_id: resolveScheduleEventTypeId(event.event_type_id),
    color_override: normalizeScheduleEventColor(event.color_override),
    attendee_user_ids: normalizeScheduleEventAttendeeUserIds(event.attendee_user_ids),
    kind: normalizeScheduleEventKind(event.kind),
    all_day: Number(event.all_day) ? 1 : 0,
    start_at: event.start_at,
    end_at: event.end_at ?? event.start_at,
    notes: String(event.notes ?? ''),
    reminder_offset_minutes: normalizeScheduleEventReminderOffsetMinutes(event.reminder_offset_minutes)
      ?? DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES,
    recurrence_interval: normalizeScheduleEventRecurrenceInterval(event.recurrence_interval),
    recurrence_unit: normalizeScheduleEventRecurrenceUnit(event.recurrence_unit)
  };
}

function storeScheduleEventClipboard(eventRecord) {
  const draft = getScheduleEventDraftFromRecord(eventRecord);
  if (!draft?.start_at) return false;
  const startAt = new Date(draft.start_at);
  if (Number.isNaN(startAt.getTime())) return false;
  const endAt = draft.end_at ? new Date(draft.end_at) : new Date(startAt.getTime());
  const resolvedEndAt = Number.isNaN(endAt.getTime()) ? new Date(startAt.getTime()) : endAt;
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const sourceDateKey = getDateKeyInTimeZone(startAt, displayTimeZone);
  if (!sourceDateKey) return false;
  scheduleEventClipboard = {
    copied_at: nowIso(),
    source_event_id: eventRecord?.id ?? null,
    source_date_key: sourceDateKey,
    source_start_minutes: getMinutesInDayInTimeZone(startAt, displayTimeZone),
    duration_ms: Math.max(0, resolvedEndAt.getTime() - startAt.getTime()),
    event: {
      ...draft,
      attendee_user_ids: [...(draft.attendee_user_ids ?? [])]
    }
  };
  return true;
}

function getSchedulePastePayload(target = {}) {
  const clipboard = scheduleEventClipboard;
  if (!clipboard?.event) return null;
  const sourceStartDateKey = String(clipboard.source_date_key ?? '').trim();
  const sourceStartAt = new Date(clipboard.event.start_at ?? '');
  if (!sourceStartDateKey || Number.isNaN(sourceStartAt.getTime())) return null;
  const sourceEndAt = clipboard.event.end_at
    ? new Date(clipboard.event.end_at)
    : new Date(sourceStartAt.getTime());
  const normalizedEndAt = Number.isNaN(sourceEndAt.getTime()) ? new Date(sourceStartAt.getTime()) : sourceEndAt;

  const targetDateParsed = parseDateOnlyValue(target?.dateKey ?? '');
  const targetDateKey = targetDateParsed ? formatDateOnlyValue(targetDateParsed) : sourceStartDateKey;
  const rawMinutes = Number(target?.startMinutes);
  const targetStartMinutes = Number.isFinite(rawMinutes)
    ? Math.max(0, Math.min((24 * 60) - 1, Math.round(rawMinutes)))
    : null;
  const sourceStartMinutes = Number.isFinite(Number(clipboard.source_start_minutes))
    ? Math.max(0, Math.min((24 * 60) - 1, Math.round(Number(clipboard.source_start_minutes))))
    : 0;
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const isAllDay = Number(clipboard.event.all_day) === 1
    || normalizeScheduleEventKind(clipboard.event.kind) === 'day-off';

  let nextStartAt = null;
  let nextEndAt = null;

  if (isAllDay) {
    const dayDelta = getDayDeltaBetweenDateKeys(sourceStartDateKey, targetDateKey);
    const shiftedStart = new Date(sourceStartAt.getTime());
    shiftedStart.setDate(shiftedStart.getDate() + dayDelta);
    const shiftedEnd = new Date(normalizedEndAt.getTime());
    shiftedEnd.setDate(shiftedEnd.getDate() + dayDelta);
    nextStartAt = shiftedStart.toISOString();
    nextEndAt = shiftedEnd.toISOString();
  } else {
    const startMinutes = targetStartMinutes === null ? sourceStartMinutes : targetStartMinutes;
    const startDate = getUtcDateForTimeZoneParts(
      Number(targetDateKey.slice(0, 4)),
      Number(targetDateKey.slice(5, 7)),
      Number(targetDateKey.slice(8, 10)),
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      displayTimeZone
    );
    if (Number.isNaN(startDate.getTime())) return null;
    const durationMs = Number.isFinite(Number(clipboard.duration_ms))
      ? Math.max(0, Number(clipboard.duration_ms))
      : Math.max(0, normalizedEndAt.getTime() - sourceStartAt.getTime());
    const endDate = new Date(startDate.getTime() + durationMs);
    nextStartAt = startDate.toISOString();
    nextEndAt = endDate.toISOString();
  }

  return {
    ...clipboard.event,
    attendee_user_ids: [...(clipboard.event.attendee_user_ids ?? [])],
    start_at: nextStartAt,
    end_at: nextEndAt
  };
}

function pasteScheduleEventFromClipboard(target = {}) {
  const payload = getSchedulePastePayload(target);
  if (!payload) return null;
  return createScheduleEventRecord(payload);
}

function closeTaskContextMenuIfOpen() {
  if (!taskContextMenu) return;
  taskContextMenu.classList.add('hidden');
  if (openMenu === taskContextMenu) {
    openMenu = null;
  }
}

function showScheduleContextMenu(items, x, y) {
  if (!taskContextMenu) return;
  if (openMenu && openMenu !== taskContextMenu) {
    openMenu.classList.add('hidden');
  }
  taskContextMenu.innerHTML = '';
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-menu-item';
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      closeTaskContextMenuIfOpen();
      if (button.disabled) return;
      try {
        await item.onSelect?.();
      } catch (err) {
        showToast({ type: 'error', message: err?.message ?? 'Action failed.' });
      }
    });
    taskContextMenu.appendChild(button);
  });
  taskContextMenu.classList.remove('hidden');
  openMenu = taskContextMenu;
  const menuRect = taskContextMenu.getBoundingClientRect();
  const nextLeft = Math.min(x, window.innerWidth - menuRect.width - 8);
  const nextTop = Math.min(y, window.innerHeight - menuRect.height - 8);
  taskContextMenu.style.left = `${Math.max(8, nextLeft)}px`;
  taskContextMenu.style.top = `${Math.max(8, nextTop)}px`;
}

function showScheduleEventContextMenu(eventRecord, x, y) {
  const scheduleEvent = eventRecord?.id
    ? getScheduleEventRecordById(eventRecord.id) ?? eventRecord
    : null;
  if (!scheduleEvent?.id) return;
  showScheduleContextMenu([
    {
      label: 'Edit',
      onSelect: () => {
        openScheduleEventModal(scheduleEvent, {}, { mode: 'edit' });
      }
    },
    {
      label: 'Copy (to clipboard)',
      onSelect: () => {
        const copied = storeScheduleEventClipboard(scheduleEvent);
        if (!copied) {
          showToast({ type: 'error', message: 'Could not copy this event.' });
          return;
        }
        showToast({ type: 'success', message: 'Event copied to clipboard.' });
      }
    },
    {
      label: 'Duplicate',
      onSelect: () => {
        const defaults = getScheduleEventDraftFromRecord(scheduleEvent);
        if (!defaults) return;
        openScheduleEventModal(null, defaults, { mode: 'create' });
      }
    },
    {
      label: 'Delete',
      onSelect: () => {
        const confirmed = confirm(`Delete "${scheduleEvent.title}"?`);
        if (!confirmed) return;
        deleteScheduleEventRecord(scheduleEvent.id);
        render();
      }
    }
  ], x, y);
}

function showSchedulePasteContextMenu(x, y, target = {}) {
  const hasClipboard = Boolean(scheduleEventClipboard?.event);
  showScheduleContextMenu([
    {
      label: hasClipboard ? 'Paste copied event' : 'Paste copied event (empty)',
      disabled: !hasClipboard,
      onSelect: () => {
        const created = pasteScheduleEventFromClipboard(target);
        if (!created) {
          showToast({ type: 'error', message: 'Could not paste event.' });
          return;
        }
        showToast({ type: 'success', message: 'Event pasted.' });
        render();
      }
    }
  ], x, y);
}

function shouldNotifyNotice(notice) {
  if (!notice?.notify_at) return false;
  if (notice.dismissed_at) return false;
  const notifyTime = new Date(notice.notify_at).getTime();
  if (Number.isNaN(notifyTime)) return false;
  if (Date.now() < notifyTime) return false;
  if (notice.notice_sent_at) {
    const sentTime = new Date(notice.notice_sent_at).getTime();
    if (!Number.isNaN(sentTime) && sentTime >= notifyTime) return false;
  }
  return true;
}

function openTaskModal(defaults = {}) {
  taskModalDefaults = defaults ?? {};
  modalTitle.value = '';
  modalPriority.value = 'medium';
  const defaultStatus = normalizeTaskStatusValue(taskModalDefaults.status);
  populateStatusSelect(modalStatus, defaultStatus);
  modalStart.value = '';
  modalDue.value = '';
  modalDesc.value = '';
  if (modalTags) modalTags.value = formatTagList(taskModalDefaults.tags ?? []);
  const defaultType = taskModalDefaults.type_label ?? getDefaultTaskTypeName();
  populateTaskTypeSelect(modalType, defaultType);
  const defaultAssigneeUserId = taskModalDefaults.assignee_user_id ?? null;
  const defaultAssigneeLabel = taskModalDefaults.assignee_label ?? '';
  if (modalAssigneeLabel) modalAssigneeLabel.value = defaultAssigneeLabel;
  populateAssigneeSelect(
    modalAssignee,
    modalAssigneeLabelRow,
    modalAssigneeLabel,
    defaultAssigneeUserId,
    defaultAssigneeLabel
  );
  modalReminder.value = '';
  const nextInterval = taskModalDefaults.recurrence_interval ?? null;
  const nextUnit = taskModalDefaults.recurrence_unit ?? 'month';
  setRecurrenceState('modal', nextInterval, nextUnit);
  taskModal.classList.remove('hidden');
  modalTitle.focus();
}

function closeTaskModal() {
  taskModal.classList.add('hidden');
  taskModalDefaults = {};
  setRecurrenceState('modal', null, 'month');
}

bindScheduleEventDescriptionEditor();

modalCancel.addEventListener('click', closeTaskModal);
taskModal.querySelector('.modal-backdrop').addEventListener('click', closeTaskModal);
scheduleEventCancel?.addEventListener('click', closeScheduleEventModal);
scheduleEventModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeScheduleEventModal);
scheduleEventEdit?.addEventListener('click', () => {
  if (!activeScheduleEventId) return;
  setScheduleEventModalMode('edit');
  scheduleEventTitle?.focus();
});
scheduleEventAllDay?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  syncScheduleEventDatetimeInputs();
});
scheduleEventKind?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  const kind = normalizeScheduleEventFormKind(scheduleEventKind.value);
  if (!scheduleEventAllDay) return;
  if (kind === 'day-off') {
    scheduleEventAllDay.checked = true;
    syncScheduleEventDatetimeInputs();
  }
});
scheduleEventType?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  syncScheduleEventDescriptionTemplate({ preserveValue: true });
  syncScheduleEventColorInputs();
});
scheduleEventRepeatUnit?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  syncScheduleEventRepeatInputs();
});
scheduleEventRepeatInterval?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  syncScheduleEventRepeatInputs();
});
scheduleEventCalendar?.addEventListener('change', () => {
  const calendarId = String(scheduleEventCalendar.value ?? '').trim();
  if (calendarId) {
    setActiveScheduleCalendarId(calendarId);
  }
  if (scheduleEventModalMode !== 'view') {
    syncScheduleEventColorInputs();
  }
});
scheduleEventColorOverride?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  syncScheduleEventColorInputs();
});
scheduleEventColor?.addEventListener('change', () => {
  if (scheduleEventModalMode === 'view') return;
  if (!normalizeScheduleEventColor(scheduleEventColor.value)) {
    syncScheduleEventColorInputs();
    return;
  }
  if (scheduleEventColorOverride && !scheduleEventColorOverride.checked) {
    scheduleEventColorOverride.checked = true;
  }
  syncScheduleEventColorInputs();
});
scheduleEventPrint?.addEventListener('click', () => {
  printScheduleEventFromModal();
});
scheduleEventDelete?.addEventListener('click', () => {
  if (!activeScheduleEventId) return;
  const confirmed = confirm('Delete this event?');
  if (!confirmed) return;
  deleteScheduleEventRecord(activeScheduleEventId);
  closeScheduleEventModal();
  render();
});
modalAssignee?.addEventListener('change', () => {
  setAssigneeLabelInputVisibility(modalAssignee, modalAssigneeLabelRow, modalAssigneeLabel);
});

mobileTaskQuickAddForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = normalizeTitleInput(mobileTaskQuickAddInput?.value ?? '');
  if (!title) {
    mobileTaskQuickAddInput?.focus();
    return;
  }
  const created = await createTaskRecord({
    title,
    project_id: getProjectIdFromTaskFilter(),
    status: getDefaultStatusKey()
  });
  if (!created) return;
  closeMobileCreateSheet();
  render();
  showToast({ type: 'success', message: 'Task added.' });
});

async function handleTaskShoppingInboxAdd() {
  const rawInput = taskShoppingInboxInput?.value ?? '';
  if (!parseShoppingItems(rawInput).length) return;
  const { added } = await addItemsToShoppingInbox(rawInput);
  if (!added) {
    showToast({ type: 'error', message: 'Could not add inbox item.' });
    return;
  }
  if (taskShoppingInboxInput) {
    taskShoppingInboxInput.value = '';
  }
  showToast({ type: 'success', message: added === 1 ? 'Added to shopping inbox.' : `Added ${added} items to shopping inbox.` });
  render();
}

taskShoppingInboxAdd?.addEventListener('click', () => {
  void handleTaskShoppingInboxAdd();
});

taskShoppingInboxInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  void handleTaskShoppingInboxAdd();
});

newShoppingListBtn?.addEventListener('click', openShoppingListModal);
shoppingListCancel?.addEventListener('click', closeShoppingListModal);
shoppingListModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShoppingListModal);
workspaceManageBack?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
workspaceArchivedBack?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
shoppingAddBtn?.addEventListener('click', openShoppingItemModal);
shoppingMobileBack?.addEventListener('click', () => {
  setMobileShoppingPanelMode('list');
  render();
});
shoppingItemCancel?.addEventListener('click', closeShoppingItemModal);
shoppingItemModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShoppingItemModal);

shoppingListStoreSelect?.addEventListener('change', () => {
  if (!shoppingListStoreSelect) return;
  if (shoppingListStoreSelect.value === '__add_new__') {
    openShoppingStoreModal();
    return;
  }
  shoppingStorePreviousSelection = shoppingListStoreSelect.value || '';
});

shoppingListParse?.addEventListener('click', () => {
  const parsed = parseShoppingListInput(shoppingListItemsInput.value);
  const items = parsed.items ?? [];
  shoppingListItemsInput.value = items.length
    ? items.join('\n')
    : normalizeShoppingItems(shoppingListItemsInput.value);
  const currentStore = shoppingListStoreSelect?.value ?? '';
  if (!currentStore && parsed.title) {
    const parsedMeta = parseStoreAndDateFromTitle(parsed.title);
    if (parsedMeta.store) {
      renderShoppingStoreSelect(parsedMeta.store);
      shoppingStorePreviousSelection = shoppingListStoreSelect?.value || '';
    }
    if (parsedMeta.date && shoppingListDate) {
      shoppingListDate.value = parsedMeta.date;
    }
  }
});

shoppingStoreCancel?.addEventListener('click', () => closeShoppingStoreModal({ restoreSelection: true }));
shoppingStoreModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeShoppingStoreModal({ restoreSelection: true }));
shoppingStoreForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const storeName = shoppingStoreNameInput?.value?.trim();
  if (!storeName) return;
  const created = await createStoreRuleRecord({ store_name: storeName, keywords: [] });
  const selectedStoreName = created?.store_name ?? normalizeTitleInput(storeName);
  renderShoppingStoreSelect(selectedStoreName);
  shoppingStorePreviousSelection = selectedStoreName;
  closeShoppingStoreModal({ restoreSelection: false });
  shoppingListStoreSelect?.focus();
});

shoppingItemParse?.addEventListener('click', () => {
  shoppingItemInput.value = normalizeShoppingItems(shoppingItemInput.value);
});

shoppingListForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const parsed = parseShoppingListInput(shoppingListItemsInput.value);
  const items = parsed.items ?? [];
  let store = shoppingListStoreSelect?.value?.trim() ?? '';
  let dateValue = shoppingListDate?.value ?? '';
  if ((!store || !dateValue) && parsed.title) {
    const parsedMeta = parseStoreAndDateFromTitle(parsed.title);
    if (!store && parsedMeta.store) store = parsedMeta.store;
    if (!dateValue && parsedMeta.date) dateValue = parsedMeta.date;
  }
  if (!dateValue && shoppingListDate) {
    dateValue = shoppingListDate.value;
  }
  if (!dateValue) {
    dateValue = new Date().toISOString().slice(0, 10);
  }
  if (!store) {
    const detectedStore = detectStoreFromItems(items);
    if (detectedStore) store = detectedStore;
  }
  if (store) {
    store = normalizeTitleInput(store);
  }
  const dateLabel = formatShortDateFromInput(dateValue);
  const name = store ? `${store} ${dateLabel}` : dateLabel;
  if (!name) return;
  const created = await createShoppingListRecord({ name });
  if (!created) return;
  if (items.length) {
    await createShoppingItemsRecord(created.id, items.map(item => ({ name: item })));
  }
  state.ui.activeShoppingListId = created.id;
  if (isMobileViewport()) {
    setMobileShoppingPanelMode('details');
  }
  setActiveView('shopping');
  closeShoppingListModal();
  render();
});

shoppingItemForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  const items = parseShoppingItems(shoppingItemInput.value);
  if (!items.length) return;
  await createShoppingItemsRecord(activeList.id, items.map(item => ({ name: item })));
  shoppingItemInput.value = '';
  closeShoppingItemModal();
  render();
});

shoppingListRename?.addEventListener('click', async (event) => {
  event.stopPropagation();
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  if (isShoppingInboxList(activeList)) return;
  const nextName = prompt('Shopping list name', activeList.name);
  if (!nextName) return;
  const updated = await updateShoppingListRecord(activeList.id, { name: nextName.trim() || activeList.name });
  if (updated) {
    state.ui.activeShoppingListId = updated.id;
  }
  shoppingListMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

shoppingListDelete?.addEventListener('click', async (event) => {
  event.stopPropagation();
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  if (isShoppingInboxList(activeList)) return;
  const confirmed = confirm(`Delete shopping list \"${activeList.name}\"?`);
  if (!confirmed) return;
  await deleteShoppingListRecord(activeList.id);
  if (state.ui?.activeShoppingListId === activeList.id) {
    const next = (state.shoppingLists ?? []).find(list => !list.archived);
    state.ui.activeShoppingListId = next?.id ?? null;
    if (isMobileViewport() && !next) {
      setMobileShoppingPanelMode('list');
    }
  }
  shoppingListMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

shoppingCompleteBtn?.addEventListener('click', async () => {
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  if (isShoppingInboxList(activeList)) return;
  const items = getShoppingItemsForList(activeList.id);
  if (!items.length) return;
  try {
    const allChecked = items.every(item => item.is_checked);
    if (!allChecked) {
      const confirmed = confirm('Mark remaining items complete and archive this list?');
      if (!confirmed) return;
      for (const item of items) {
        if (!item.is_checked) {
          await updateShoppingItemRecord(item.id, { is_checked: 1 });
        }
      }
    }
    await archiveShoppingListRecord(activeList.id, { skipFallbackView: true });
    setActiveView('shopping');
    if (isMobileViewport()) {
      setMobileShoppingPanelMode('list');
    }
    render();
  } catch {
    alert('Could not complete this shopping list right now.');
  }
});

settingsOpen?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  openSettings();
});
settingsTabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tab = String(button.dataset.settingsTab ?? '').trim();
    if (!tab) return;
    setSettingsTab(tab);
    renderSettingsTabs();
  });
});
settingsClose?.addEventListener('click', closeSettings);
settingsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
settingsOpenTemplates?.addEventListener('click', openTemplateManagerModal);
settingsOpenDataTransfer?.addEventListener('click', () => {
  openSettingsLinkedPage('data-transfer');
});
settingsOpenAuditLog?.addEventListener('click', () => {
  openSettingsLinkedPage('audit-log');
});
settingsOpenAutomation?.addEventListener('click', () => {
  openSettingsLinkedPage('automation');
});
settingsOpenHelp?.addEventListener('click', () => {
  openSettingsLinkedPage('help');
});
templateManagerClose?.addEventListener('click', () => closeTemplateManagerModal());
templateManagerModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeTemplateManagerModal());
teamMemberAddBtn?.addEventListener('click', async () => {
  if (!state.workspace) return;
  const name = teamMemberNameInput?.value?.trim() ?? '';
  if (!name) return;
  const email = teamMemberEmailInput?.value?.trim() ?? '';
  const role = teamMemberRoleSelect?.value ?? 'member';
  try {
    let user = null;
    const existingUsers = getUsersForCurrentWorkspace();
    if (email) {
      user = existingUsers.find(entry => String(entry.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
    }
    if (!user) {
      user = existingUsers.find(entry => entry.display_name === name) ?? null;
    }
    if (!user) {
      user = await createUserRecord({ display_name: name, email: email || null });
    }
    if (!user) return;
    const existingMembership = (state.workspaceMemberships ?? []).find(item =>
      item.workspace_id === state.workspace.id && item.user_id === user.id && !item.archived
    );
    if (existingMembership) {
      await updateWorkspaceMembershipRecord(existingMembership.id, { role });
    } else {
      await createWorkspaceMembershipRecord({ user_id: user.id, role });
    }
    if (teamMemberNameInput) teamMemberNameInput.value = '';
    if (teamMemberEmailInput) teamMemberEmailInput.value = '';
    if (teamMemberRoleSelect) teamMemberRoleSelect.value = 'member';
    render();
  } catch (err) {
    alert(err?.message ?? 'Unable to add member.');
  }
});
dataTransferBack?.addEventListener('click', returnFromSettingsLinkedPage);
auditLogBack?.addEventListener('click', returnFromSettingsLinkedPage);
automationBack?.addEventListener('click', returnFromSettingsLinkedPage);
helpBack?.addEventListener('click', returnFromSettingsLinkedPage);
dataExportDownload?.addEventListener('click', exportCurrentWorkspaceData);
dataImportApply?.addEventListener('click', async () => {
  const file = dataImportFile?.files?.[0];
  if (!file) {
    alert('Choose a JSON export file first.');
    return;
  }
  const replaceExisting = Boolean(dataImportReplace?.checked);
  if (replaceExisting) {
    const confirmed = confirm('Replace all data for the imported workspace ID with file contents?');
    if (!confirmed) return;
  }
  try {
    await importWorkspaceFromJsonFile(file, { replaceExisting });
    syncStatus.textContent = 'Import completed (local)';
    if (dataImportFile) dataImportFile.value = '';
  } catch (err) {
    alert(err?.message ?? 'Import failed.');
  }
});
auditLogFilter?.addEventListener('change', renderAuditLogOutput);
auditLogRefresh?.addEventListener('click', renderAuditLogOutput);
auditLogCopy?.addEventListener('click', async () => {
  try {
    await copyAuditLogOutput();
  } catch (err) {
    alert(err?.message ?? 'Could not copy audit log.');
  }
});
auditLogClear?.addEventListener('click', () => {
  const confirmed = confirm('Clear all audit log entries?');
  if (!confirmed) return;
  clearAuditLogOutput();
});
automationRun?.addEventListener('click', async () => {
  try {
    await runAutomationCommandsFromInput();
  } catch (err) {
    const message = err?.message ?? 'Automation failed.';
    setAutomationOutputText(JSON.stringify({ ok: false, error: message }, null, 2));
    appendAuditEvent({
      source: 'automation',
      category: 'error',
      event: 'batch_failed',
      data: { message }
    });
  }
});
automationClear?.addEventListener('click', () => {
  if (automationInput) automationInput.value = '';
  setAutomationOutputText('');
});
automationCopyGuide?.addEventListener('click', async () => {
  const originalLabel = automationCopyGuide.textContent || 'Copy syntax';
  try {
    await copyAutomationSyntaxGuide();
    automationCopyGuide.textContent = 'Copied';
    setTimeout(() => {
      if (automationCopyGuide) automationCopyGuide.textContent = originalLabel;
    }, 1200);
  } catch {
    alert('Could not copy syntax instructions.');
  }
});
profileOpen?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  openProfile();
});
profilePageBack?.addEventListener('click', closeProfile);
profilePageSave?.addEventListener('click', saveProfilePage);
accountLogout?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  handleAccountAuthAction();
});
accountAdmin?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  openAdminConsole();
});
adminPageBack?.addEventListener('click', closeAdminConsole);
adminInviteSend?.addEventListener('click', () => {
  void submitAdminInvite();
});
adminInviteTokenCopy?.addEventListener('click', async () => {
  const token = String(adminInviteToken?.value ?? '').trim();
  await copyInviteLinkToClipboard(token);
});
adminUsersRefresh?.addEventListener('click', () => {
  void refreshAdminUsers();
});
adminUserSelect?.addEventListener('change', () => {
  const adminState = getAdminState();
  adminState.selectedUserId = adminUserSelect.value || '';
  renderAdminUsersList();
  renderAdminUserEditor();
});
adminUserSave?.addEventListener('click', () => {
  void submitAdminUserUpdate();
});
adminUserPasswordReset?.addEventListener('click', () => {
  void submitAdminPasswordReset();
});
adminUserExport?.addEventListener('click', () => {
  void exportAdminSelectedUser();
});
adminUserDelete?.addEventListener('click', () => {
  void deleteAdminSelectedUser();
});
adminOwnershipTransfer?.addEventListener('click', () => {
  void transferOwnershipToSelectedUser();
});
taskTypesOpen?.addEventListener('click', openTaskTypesModal);
taskTypesClose?.addEventListener('click', closeTaskTypesModal);
taskTypesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTaskTypesModal);
scheduleEventTypesOpen?.addEventListener('click', openScheduleEventTypesModal);
scheduleEventTypesClose?.addEventListener('click', closeScheduleEventTypesModal);
scheduleEventTypesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeScheduleEventTypesModal);
storeRulesOpen?.addEventListener('click', openStoreRulesModal);
storeRulesClose?.addEventListener('click', closeStoreRulesModal);
storeRulesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeStoreRulesModal);

editorCancel?.addEventListener('click', closeTaskEditor);
editorClose?.addEventListener('click', closeTaskEditor);
editorTitle?.addEventListener('input', () => scheduleTaskEditorAutosave('title', 700));
editorTitle?.addEventListener('blur', () => scheduleTaskEditorAutosave('title-blur', 200));
editorType?.addEventListener('change', () => scheduleTaskEditorAutosave('type', 300));
editorTags?.addEventListener('input', () => scheduleTaskEditorAutosave('tags', 500));
editorTags?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  // Prevent implicit form submit so extension form hooks (e.g. Dashlane) do not run on tag edits.
  event.preventDefault();
  event.stopPropagation();
  scheduleTaskEditorAutosave('tags-enter', 120);
});
editorPriority?.addEventListener('change', () => scheduleTaskEditorAutosave('priority', 300));
editorProject?.addEventListener('change', () => scheduleTaskEditorAutosave('project', 300));
editorAssignee?.addEventListener('change', () => {
  setAssigneeLabelInputVisibility(editorAssignee, editorAssigneeLabelRow, editorAssigneeLabel);
  scheduleTaskEditorAutosave('assignee', 300);
});
editorAssigneeLabel?.addEventListener('input', () => scheduleTaskEditorAutosave('assignee-label', 400));
editorParent?.addEventListener('change', () => scheduleTaskEditorAutosave('parent', 300));
editorReminder?.addEventListener('input', () => scheduleTaskEditorAutosave('reminder', 500));
editorReminder?.addEventListener('change', () => scheduleTaskEditorAutosave('reminder', 300));
editorStart?.addEventListener('change', () => scheduleTaskEditorAutosave('start', 300));
editorDue?.addEventListener('change', () => scheduleTaskEditorAutosave('due', 300));
editorFollowup?.addEventListener('change', () => scheduleTaskEditorAutosave('followup', 300));
editorDesc?.addEventListener('input', () => scheduleTaskEditorAutosave('notes', 700));
editorStatus?.addEventListener('change', () => {
  updateEditorFollowupVisibility(editorStatus.value);
  if (isWaitingStatusKey(editorStatus.value) && editorFollowup && !editorFollowup.value) {
    const next = addInterval(new Date(), 3, 'day');
    editorFollowup.value = toDatetimeLocal(next.toISOString());
  }
  scheduleTaskEditorAutosave('status', 300);
});
editorFollowupNow?.addEventListener('click', () => {
  ensureEditorWaitingStatus();
  setEditorFollowupValue(new Date().toISOString());
  scheduleTaskEditorAutosave('followup-now', 300);
});
editorFollowupSnooze?.addEventListener('click', () => {
  ensureEditorWaitingStatus();
  const next = addInterval(new Date(), 3, 'day');
  setEditorFollowupValue(next.toISOString());
  scheduleTaskEditorAutosave('followup-snooze', 300);
});
editorFollowupClear?.addEventListener('click', () => {
  if (editorFollowup) editorFollowup.value = '';
  scheduleTaskEditorAutosave('followup-clear', 300);
});

taskBulkEditBtn?.addEventListener('click', openBulkEditModal);
taskBulkDeleteBtn?.addEventListener('click', handleBulkDelete);
taskBulkClearBtn?.addEventListener('click', clearSelectedTasks);
taskBulkUndoButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!taskBulkUndoMenu) return;
  if (openMenu && openMenu !== taskBulkUndoMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskBulkUndoMenu.classList.contains('hidden')) {
    taskBulkUndoMenu.classList.remove('hidden');
    openMenu = taskBulkUndoMenu;
  } else {
    taskBulkUndoMenu.classList.add('hidden');
    openMenu = null;
  }
});

bulkEditCancel?.addEventListener('click', closeBulkEditModal);
bulkEditModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeBulkEditModal);
bulkEditForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await applyBulkEdit();
});

groupRenameCancel?.addEventListener('click', closeGroupRenameModal);
groupRenameModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeGroupRenameModal);
groupRenameForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sectionInfo = renameGroupTarget;
  if (!sectionInfo?.label) {
    closeGroupRenameModal();
    return;
  }
  const nextName = groupRenameInput?.value.trim() ?? '';
  if (!nextName) {
    groupRenameInput?.focus();
    return;
  }
  if (nextName === sectionInfo.label) {
    closeGroupRenameModal();
    return;
  }
  await renameTaskGroup(sectionInfo, nextName);
  closeGroupRenameModal();
});
sectionSettingsCancel?.addEventListener('click', closeSectionSettingsModal);
sectionSettingsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSectionSettingsModal);
sectionSettingsForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const sectionInfo = sectionSettingsTarget;
  if (!sectionInfo?.label) {
    closeSectionSettingsModal();
    return;
  }
  const completedValue = sectionSettingsCompleted?.value ?? 'default';
  const completedOverride = completedValue === 'default' ? null : normalizeTaskCompletedVisibility(completedValue);

  const rawFutureValue = sectionSettingsFutureDays?.value?.trim() ?? '';
  let futureOverride = null;
  if (rawFutureValue !== '') {
    const parsed = Number(rawFutureValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      sectionSettingsFutureDays?.focus();
      return;
    }
    futureOverride = Math.floor(parsed);
  }

  setTaskSectionCompletedVisibilityOverride(sectionInfo, completedOverride);
  setTaskSectionFutureVisibilityOverrideDays(sectionInfo, futureOverride);
  closeSectionSettingsModal();
  render();
});
editorAddDependencyBtn?.addEventListener('click', async () => {
  if (!activeTaskId || !editorDependencySelect) return;
  const dependsOnId = editorDependencySelect.value;
  if (!dependsOnId) return;
  try {
    const created = await api.addTaskDependency(activeTaskId, dependsOnId);
    const existing = (state.taskDependencies ?? [])
      .some(dep => dep.task_id === activeTaskId && dep.depends_on_id === dependsOnId);
    if (!existing) {
      state.taskDependencies = [...(state.taskDependencies ?? []), created];
    }
    render();
  } catch (err) {
    alert(err?.message ?? 'Unable to add dependency.');
  }
});

taskEditorForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeTaskId) return;
  const task = state.tasks[activeTaskId];
  if (!task) return;
  const title = editorTitle.value.trim();
  if (!title) return;
  const nextStatus = editorStatus.value;
  if (isDoneStatusKey(nextStatus) && hasIncompleteDependencies(task.id)) {
    alert('This task has incomplete dependencies. Complete them first.');
    return;
  }
  if (isDoneStatusKey(nextStatus) && hasIncompleteDescendants(task.id)) {
    const confirmed = confirm('This task has incomplete subtasks. Mark complete anyway?');
    if (!confirmed) return;
  }
  const nextParentId = editorParent?.value || null;
  const parentChanged = (task.parent_id ?? null) !== (nextParentId ?? null);
  const description = getNotesContent();
  const typeLabel = editorType.value ? editorType.value.trim() : null;
  const tags = normalizeTagList(editorTags?.value ?? '');
  const recurrence = editorRecurrence ?? { interval: null, unit: null };
  const startAt = editorStart ? fromDatetimeLocal(editorStart.value) : null;
  const assigneeSelection = editorAssignee?.value ?? ASSIGNEE_SELECT_NONE;
  const assigneeUserId = assigneeSelection && assigneeSelection !== ASSIGNEE_SELECT_EXTERNAL
    ? assigneeSelection
    : null;
  const assigneeLabel = assigneeSelection === ASSIGNEE_SELECT_EXTERNAL
    ? (editorAssigneeLabel?.value?.trim() ?? '')
    : null;
  const patch = {
    type_label: typeLabel,
    tags,
    title,
    description_md: description,
    priority: editorPriority.value,
    assignee_user_id: assigneeUserId,
    assignee_label: assigneeLabel || null,
    recurrence_interval: recurrence.interval ?? null,
    recurrence_unit: recurrence.interval ? recurrence.unit : null,
    reminder_offset_days: parseInt(editorReminder.value, 10) || null,
    auto_debit: task.auto_debit ?? 0,
    due_at: fromDatetimeLocal(editorDue.value),
    status: nextStatus
  };
  if (editorProject) {
    patch.project_id = editorProject.value || null;
  }
  if (editorStart) {
    patch.start_at = startAt;
  }
  if (parentChanged) {
    patch.sort_order = getNextTaskSortOrder(nextParentId, nextParentId ? null : nextStatus);
  }
  const wasWaiting = isWaitingStatusKey(task.status ?? getDefaultStatusKey());
  if (isWaitingStatusKey(nextStatus)) {
    const followupAt = fromDatetimeLocal(editorFollowup?.value ?? '');
    patch.waiting_followup_at = followupAt;
    if (followupAt) {
      patch.next_checkin_at = followupAt;
    } else {
      const withFollowup = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date());
      patch.next_checkin_at = withFollowup.next_checkin_at;
    }
  } else if (wasWaiting) {
    patch.waiting_followup_at = null;
    if (task.waiting_followup_at && task.next_checkin_at === task.waiting_followup_at) {
      patch.next_checkin_at = null;
    }
  }
  if (isDoneStatusKey(nextStatus)) {
    patch.completed_at = task.completed_at ?? nowIso();
  } else {
    patch.completed_at = null;
  }
  if (parentChanged) {
    try {
      await reparentTaskRecord(task.id, nextParentId);
    } catch (err) {
      alert(err?.message ?? 'Unable to move task.');
      return;
    }
  }
  await updateTaskRecord(task.id, patch);
  if (isDoneStatusKey(nextStatus)) {
    await maybeCreateRecurringTask(state.tasks[task.id]);
    await maybePromptCompleteParent(task.id);
  }
  closeTaskEditor();
  render();
});

editorDelete?.addEventListener('click', async () => {
  if (!activeTaskId) return;
  const task = state.tasks[activeTaskId];
  if (!task) return;
  const confirmed = confirm(`Delete \"${task.title}\" and all subtasks?`);
  if (!confirmed) return;
  await deleteTaskSubtree(task.id);
  closeTaskEditor();
  render();
});


templatePromptStart?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  const template = (state.templates ?? []).find(t => t.id === task?.template_id);
  if (task && template) {
    await updateTaskRecord(task.id, { template_prompt_pending: 0 });
    await startPlanFromReminder(task, template);
  }
  closeTemplatePrompt();
  await refreshWorkspace();
});

templatePromptDefer?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  if (!task) return;
  const days = Number(prompt('Defer by how many days?', '3'));
  if (!Number.isFinite(days) || days <= 0) return;
  const newDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  await updateTaskRecord(task.id, {
    due_at: newDue,
    template_defer_until: newDue,
    template_prompt_pending: 0
  });
  closeTemplatePrompt();
  render();
});

templatePromptDismiss?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  const template = (state.templates ?? []).find(t => t.id === task?.template_id);
  if (template) await advanceTemplateDate(template);
  if (task) await deleteTaskRecord(task.id);
  closeTemplatePrompt();
  render();
});

templatePrompt?.querySelector('.modal-backdrop')?.addEventListener('click', dismissTemplatePrompt);

taskModalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = modalTitle.value.trim();
  if (!title) return;
  const description = modalDesc.value ?? '';
  const typeLabel = modalType.value ? modalType.value.trim() : null;
  const tags = normalizeTagList(modalTags?.value ?? '');
  const parentId = taskModalDefaults.parent_id ?? null;
  const projectId = getProjectIdFromTaskFilter();
  const recurrence = modalRecurrence ?? { interval: null, unit: null };
  const assigneeSelection = modalAssignee?.value ?? ASSIGNEE_SELECT_NONE;
  const assigneeUserId = assigneeSelection && assigneeSelection !== ASSIGNEE_SELECT_EXTERNAL
    ? assigneeSelection
    : null;
  const assigneeLabel = assigneeSelection === ASSIGNEE_SELECT_EXTERNAL
    ? (modalAssigneeLabel?.value?.trim() ?? '')
    : null;
  await createTaskRecord({
    title,
    parent_id: parentId,
    project_id: projectId,
    assignee_user_id: assigneeUserId,
    assignee_label: assigneeLabel || null,
    priority: modalPriority.value,
    status: modalStatus.value,
    type_label: typeLabel,
    tags,
    recurrence_interval: recurrence.interval ?? null,
    recurrence_unit: recurrence.interval ? recurrence.unit : null,
    reminder_offset_days: parseInt(modalReminder.value, 10) || null,
    auto_debit: 0,
    start_at: fromDatetimeLocal(modalStart.value),
    due_at: fromDatetimeLocal(modalDue.value),
    description_md: description
  });
  closeTaskModal();
  render();
});

scheduleEventForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (scheduleEventModalMode === 'view') return;
  if (!state.workspace) return;
  const displayTimeZone = getSchedulingDisplayTimeZone();
  const title = normalizeTitleInput(scheduleEventTitle?.value ?? '');
  const calendarId = String(scheduleEventCalendar?.value ?? '').trim() || getActiveScheduleCalendarId();
  const eventTypeId = String(scheduleEventType?.value ?? '').trim() || null;
  const colorOverride = scheduleEventColorOverride?.checked
    ? (normalizeScheduleEventColor(scheduleEventColor?.value ?? '') ?? null)
    : null;
  const attendeeUserIds = getSelectedScheduleEventAttendeeUserIds();
  const reminderOffsetMinutes = normalizeScheduleEventReminderOffsetMinutes(scheduleEventReminder?.value ?? '')
    ?? DEFAULT_SCHEDULE_EVENT_REMINDER_MINUTES;
  const kind = normalizeScheduleEventFormKind(scheduleEventKind?.value ?? 'event');
  const allDay = Boolean(scheduleEventAllDay?.checked) || kind === 'day-off';
  const repeatUnit = normalizeScheduleEventRecurrenceUnit(scheduleEventRepeatUnit?.value ?? '');
  const repeatInterval = repeatUnit
    ? normalizeScheduleEventRecurrenceInterval(scheduleEventRepeatInterval?.value ?? '')
    : null;
  const startAt = allDay
    ? fromDateInputValueInTimeZone(scheduleEventStart?.value ?? '', displayTimeZone)
    : fromDatetimeLocalInTimeZone(scheduleEventStart?.value ?? '', displayTimeZone);
  let endAt = allDay
    ? fromDateInputValueInTimeZone(scheduleEventEnd?.value ?? '', displayTimeZone)
    : fromDatetimeLocalInTimeZone(scheduleEventEnd?.value ?? '', displayTimeZone);
  if (!startAt) {
    alert('Start date/time is required.');
    return;
  }
  if (!calendarId) {
    alert('Select a calendar.');
    return;
  }
  if (!endAt) {
    endAt = startAt;
  }
  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    alert('End must be after start.');
    return;
  }
  const payload = {
    title: title || (kind === 'day-off' ? 'Day off' : 'Untitled event'),
    calendar_id: calendarId,
    event_type_id: eventTypeId,
    color_override: colorOverride,
    attendee_user_ids: attendeeUserIds,
    kind,
    all_day: allDay ? 1 : 0,
    start_at: startAt,
    end_at: endAt,
    notes: getScheduleEventDescriptionValue(),
    reminder_offset_minutes: reminderOffsetMinutes,
    recurrence_interval: repeatInterval,
    recurrence_unit: repeatUnit
  };
  if (activeScheduleEventId) {
    updateScheduleEventRecord(activeScheduleEventId, payload);
  } else {
    createScheduleEventRecord(payload);
  }
  closeScheduleEventModal();
  render();
});

schedulingAddBtn?.addEventListener('click', () => {
  openScheduleEventCreate('event');
});


newTemplateBtn?.addEventListener('click', () => openTemplateModal(null));
templateCancel?.addEventListener('click', closeTemplateModal);
templateModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTemplateModal);

templateModalForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = normalizeTitleInput(templateName.value);
  if (!name) return;
  const data = {
    name,
    steps: parseTemplateSteps(templateSteps.value),
    lead_days: parseInt(templateLeadDays.value, 10) || 0,
    next_event_date: templateNextDate.value || null,
    project_id: templateProject.value || null,
    recurrence_interval: parseInt(templateRepeatInterval.value, 10) || null,
    recurrence_unit: templateRepeatInterval.value ? templateRepeatUnit.value : null
  };
  if (!state.workspace) return;
  let updated;
  if (editingTemplateId) {
    updated = await api.updateTemplate(editingTemplateId, data);
  } else {
    updated = await api.createTemplate({ ...data, workspace_id: state.workspace.id });
  }
  if (updated) upsertTemplate(updated);
  closeTemplateModal();
  render();
});

workflowCancel?.addEventListener('click', closeWorkflowModal);
workflowModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeWorkflowModal);
workflowModalForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.workspace) return;
  const name = workflowNameInput?.value.trim() ?? '';
  if (!name) return;
  const description = workflowDescriptionInput?.value?.trim() ?? '';
  let workflow = null;
  if (editingWorkflowId) {
    workflow = updateWorkflowRecord(editingWorkflowId, { name, description });
  } else {
    workflow = createWorkflowRecord({ name, description });
  }
  if (workflow) {
    setActiveWorkflowId(workflow.id);
    setActiveView('workflows');
  }
  closeWorkflowModal();
  render();
});

workflowInstanceCancel?.addEventListener('click', closeWorkflowInstanceModal);
workflowInstanceModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeWorkflowInstanceModal);
workflowInstanceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const workflowId = getActiveWorkflowId();
  if (!workflowId) return;
  const variantId = workflowInstanceVariant?.value ?? '';
  if (!variantId) return;
  const title = workflowInstanceTitleInput?.value.trim() ?? '';
  if (!title) return;
  const notes = workflowInstanceNotesInput?.value ?? '';
  const instance = createWorkflowInstanceRecord({
    workflowId,
    variantId,
    title,
    notes
  });
  if (instance) {
    await scaffoldWorkflowInstance(instance, variantId);
  }
  closeWorkflowInstanceModal();
  render();
  if (instance && getWorkflowApplicabilityEntries(instance.id).length) {
    openWorkflowApplicabilityModal(instance.id);
  }
});

workflowApplicabilityCancel?.addEventListener('click', closeWorkflowApplicabilityModal);
workflowApplicabilityModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeWorkflowApplicabilityModal);
workflowApplicabilityForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  applyWorkflowApplicabilitySelections();
  closeWorkflowApplicabilityModal();
  render();
});

newWorkspaceBtn.addEventListener('click', async () => {
  workspaceMenu?.classList.add('hidden');
  openMenu = null;
  const name = prompt('Workspace name');
  if (!name) return;
  const trimmed = normalizeTitleInput(name);
  let workspace = null;
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createWorkspace({ name: trimmed, type: 'personal' });
      workspace = created ? normalizeWorkspace(created) : null;
    } catch {
      // offline fallback
    }
  }
  if (!workspace) {
    const now = new Date().toISOString();
    workspace = normalizeWorkspace({
      id: createId(),
      name: trimmed,
      type: 'personal',
      archived: 0,
      created_at: now,
      updated_at: now
    });
    queueLocalChange({
      entity_type: 'workspace',
      entity_id: workspace.id,
      action: 'create',
      payload: { id: workspace.id, name: trimmed, type: 'personal' }
    });
    syncStatus.textContent = 'Offline changes pending';
  }
  state.workspaces = state.workspaces ?? [];
  state.workspaces.push(workspace);
  await selectWorkspace(workspace);
});

newProjectBtn?.addEventListener('click', async () => {
  const name = prompt('Project name');
  if (!name) return;
  if (!state.workspace) return;
  const project = await createProjectRecord(normalizeTitleInput(name));
  if (!project) return;
  setActiveTaskFilter(project.id);
  clearActiveWorkflowChecklistInstanceId();
  render();
});

projectsAddBtn?.addEventListener('click', () => {
  newProjectBtn?.click();
});

showArchivedShoppingToggle?.addEventListener('change', () => {
  state.ui = state.ui ?? {};
  state.ui.showArchivedShoppingLists = showArchivedShoppingToggle.checked;
  render();
});

enableNotificationsBtn?.addEventListener('change', async () => {
  if (!('Notification' in window)) {
    render();
    return;
  }
  if (!enableNotificationsBtn.checked) {
    state.ui = state.ui ?? {};
    state.ui.notificationsEnabled = false;
    appendAuditEvent({
      source: 'app',
      category: 'notification',
      event: 'notifications_disabled'
    });
    queueUserSettingsSave();
    render();
    return;
  }
  const permission = await Notification.requestPermission();
  state.ui = state.ui ?? {};
  state.ui.notificationsEnabled = permission === 'granted';
  appendAuditEvent({
    source: 'app',
    category: 'notification',
    event: state.ui.notificationsEnabled ? 'notifications_enabled' : 'notifications_blocked',
    data: { permission }
  });
  queueUserSettingsSave();
  render();
});

setInterval(checkNotices, 60 * 1000);
setInterval(maybeShowCheckinModal, 60 * 1000);

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    const snapshot = event?.state?.brianhubNav;
    if (!snapshot) return;
    const applied = applyNavigationStateSnapshot(snapshot);
    if (!applied) return;
    navigationHistoryApplying = true;
    try {
      render();
    } finally {
      navigationHistoryApplying = false;
      navigationHistoryReady = true;
      navigationHistoryLastSignature = getNavigationStateSignature(buildNavigationStateSnapshot());
    }
  });

  window.addEventListener('error', (event) => {
    showToast({
      type: 'error',
      message: 'Something went wrong.',
      details: event?.message ?? 'Unexpected client error'
    });
    appendAuditEvent({
      source: 'app',
      category: 'error',
      event: 'window_error',
      data: {
        message: event?.message ?? 'Unknown error',
        file: event?.filename ?? null,
        line: event?.lineno ?? null,
        column: event?.colno ?? null
      }
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const details = reason?.requestId
      ? `${reason?.message ?? String(reason ?? 'Unhandled rejection')} (RequestId: ${reason.requestId})`
      : (reason?.message ?? String(reason ?? 'Unhandled rejection'));
    showToast({
      type: 'error',
      message: 'Request failed.',
      details
    });
    appendAuditEvent({
      source: 'app',
      category: 'error',
      event: 'unhandled_rejection',
      data: {
        message: reason?.message ?? String(reason ?? 'Unhandled rejection')
      }
    });
  });

  window.addEventListener('brianhub:api', (event) => {
    const detail = event?.detail ?? {};
    if (detail.ok) return;
    const status = Number(detail.status ?? 0);
    if (status > 0 && status < 500) return;
    const requestId = detail.request_id ?? null;
    const message = status >= 500
      ? 'Server error while processing request.'
      : 'Network error while syncing.';
    showToast({
      type: 'warn',
      message,
      details: requestId ? `RequestId: ${requestId}` : (detail.error ?? 'Try again shortly.')
    });
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) {
      closeMobileCreateSheet();
      closeMobileTopMenu();
    }
    renderMobileNavigation();
  });

  window.addEventListener('online', () => {
    updateSyncOfflineNotice(false);
  });

  window.addEventListener('offline', () => {
    updateSyncOfflineNotice(true);
    if (syncStatus) {
      syncStatus.textContent = `Offline · queued ${(state.local?.pendingChanges ?? []).length}`;
    }
  });
}

function buildFatalDiagnostics(error) {
  return {
    ts: new Date().toISOString(),
    message: error?.message ?? 'Unknown init failure',
    stack: error?.stack ?? null
  };
}

function renderFatalInitOverlay(error) {
  const diagnostics = buildFatalDiagnostics(error);
  const existing = document.querySelector('.fatal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'fatal-overlay';
  const card = document.createElement('div');
  card.className = 'fatal-card';
  const heading = document.createElement('h2');
  heading.textContent = 'BrianHub could not initialize';
  const body = document.createElement('p');
  body.textContent = 'Reload the page. If this persists, copy diagnostics and share with support/dev.';
  const actions = document.createElement('div');
  actions.className = 'fatal-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'subtle-button';
  copyBtn.textContent = 'Copy diagnostics';
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify(diagnostics, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'success', message: 'Diagnostics copied.' });
    } catch {
      showToast({ type: 'error', message: 'Could not copy diagnostics.' });
    }
  });
  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.className = 'subtle-button';
  reloadBtn.textContent = 'Reload';
  reloadBtn.addEventListener('click', () => {
    window.location.reload();
  });
  actions.appendChild(copyBtn);
  actions.appendChild(reloadBtn);
  card.appendChild(heading);
  card.appendChild(body);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function init() {
  initNotesEditor();
  setAuthModalMode('login');
  updateSyncOfflineNotice();
  const inviteToken = getInviteTokenFromUrl();
  await hydrateAuthSession();
  if (state.ui?.forceAuthGate) {
    applyAuthPayload({ authenticated: false }, { persistProfile: false });
    clearWorkspaceDomainData();
    render();
    if (inviteToken) {
      openAuthModal('invite', { inviteToken });
    } else {
      openAuthModal('login');
    }
    return;
  }
  if (shouldShowAuthGatePage()) {
    clearWorkspaceDomainData();
    render();
    if (inviteToken) {
      openAuthModal('invite', { inviteToken });
    } else {
      openAuthModal('login');
    }
    return;
  }
  render();
  await loadWorkspaces();
  await refreshWorkspace();
  await primeSyncCursor();
  if (inviteToken && !isAuthenticatedActor()) {
    openAuthModal('invite', { inviteToken });
  }
  checkNotices();
  maybeShowCheckinModal();
}

init().catch((error) => {
  appendAuditEvent({
    source: 'app',
    category: 'error',
    event: 'init_failed',
    data: {
      message: error?.message ?? 'Unknown init failure'
    }
  });
  renderFatalInitOverlay(error);
});

setInterval(() => {
  if (document.hidden) return;
  autoRefreshOnChanges();
}, SYNC_POLL_INTERVAL_MS);
