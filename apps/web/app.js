import { loadState, saveState, createId } from './localStore.js';
import { loadLocalData, saveLocalData, recordLocalChange } from './localData.js';
import * as api from './api.js';
import { compareTasksByPriority } from '../../packages/core/priority.js';
import { reparent as reparentTasks } from '../../packages/core/tree.js';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../packages/core/taskState.js';

const localData = loadLocalData();
const state = {
  ...loadState(),
  workspaces: localData.workspaces ?? [],
  workspace: null,
  projects: localData.projects ?? [],
  templates: localData.templates ?? [],
  statuses: localData.statuses ?? [],
  taskTypes: localData.taskTypes ?? [],
  storeRules: localData.storeRules ?? [],
  tasks: localData.tasks ?? {},
  taskDependencies: localData.taskDependencies ?? [],
  notices: localData.notices ?? [],
  noticeTypes: localData.noticeTypes ?? [],
  shoppingLists: localData.shoppingLists ?? [],
  shoppingItems: localData.shoppingItems ?? {},
  local: {
    localSeq: localData.localSeq ?? 0,
    pendingChanges: localData.pendingChanges ?? []
  }
};
const DEFAULT_NOTICE_TYPES = [
  { key: 'general', label: 'General' },
  { key: 'bill', label: 'Bill notice' },
  { key: 'auto-payment', label: 'Auto-payment notice' }
];
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
const taskTreeEl = document.getElementById('task-tree');
const taskFilterButton = document.getElementById('task-filter-button');
const taskFilterMenu = document.getElementById('task-filter-menu');
const taskSortButton = document.getElementById('task-sort-button');
const taskSortMenu = document.getElementById('task-sort-menu');
const taskViewSelect = document.getElementById('task-view-select');
const taskColumnsButton = document.getElementById('task-columns-button');
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
const taskTypeListEl = document.getElementById('task-type-list');
const taskTypeNameInput = document.getElementById('task-type-name');
const taskTypeAddBtn = document.getElementById('task-type-add');
const storeRuleListEl = document.getElementById('store-rule-list');
const storeRuleNameInput = document.getElementById('store-rule-name');
const storeRuleKeywordsInput = document.getElementById('store-rule-keywords');
const storeRuleAddBtn = document.getElementById('store-rule-add');
const projectListEl = document.getElementById('project-list');
const newProjectBtn = document.getElementById('new-project-btn');
const tasksOpenBtn = document.getElementById('tasks-open');
const shoppingListListEl = document.getElementById('shopping-list-list');
const newShoppingListBtn = document.getElementById('new-shopping-list-btn');
const noticeListEl = document.getElementById('notice-list');
const newNoticeSidebarBtn = document.getElementById('new-notice-sidebar-btn');
const noticesOpenBtn = document.getElementById('notices-open');
const noticesPage = document.getElementById('notices-page');
const noticesBackBtn = document.getElementById('notices-back');
const noticesListEl = document.getElementById('notices-list');
const noticesAddBtn = document.getElementById('notices-add-btn');
const noticeFilterButton = document.getElementById('notice-filter-button');
const noticeFilterMenu = document.getElementById('notice-filter-menu');
const noticeSortButton = document.getElementById('notice-sort-button');
const noticeSortMenu = document.getElementById('notice-sort-menu');
const tasksPanel = document.getElementById('tasks-panel');
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
const shoppingBack = document.getElementById('shopping-back');
const shoppingAddBtn = document.getElementById('shopping-add-item');
const shoppingListSidebarMenuButton = document.getElementById('shopping-list-sidebar-menu-button');
const shoppingListSidebarMenu = document.getElementById('shopping-list-sidebar-menu');
const showArchivedShoppingToggle = document.getElementById('show-archived-shopping');
const shoppingListMenuButton = document.getElementById('shopping-list-menu-button');
const shoppingListMenu = document.getElementById('shopping-list-menu');
const shoppingListRename = document.getElementById('shopping-list-rename');
const shoppingListDelete = document.getElementById('shopping-list-delete');
const shoppingListModal = document.getElementById('shopping-list-modal');
const shoppingListForm = document.getElementById('shopping-list-form');
const shoppingListStoreSelect = document.getElementById('shopping-list-store-select');
const shoppingListStoreNewRow = document.getElementById('shopping-list-store-new-row');
const shoppingListStoreNew = document.getElementById('shopping-list-store-new');
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
const syncBtn = document.getElementById('sync-btn');
const syncStatus = document.getElementById('sync-status');
const newWorkspaceBtn = document.getElementById('new-workspace-btn');
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
const modalRecurringButton = document.getElementById('modal-recurring-button');
const modalRecurringSummary = document.getElementById('modal-recurring-summary');
const modalReminder = document.getElementById('modal-reminder');
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
const accountButton = document.getElementById('account-button');
const accountMenu = document.getElementById('account-menu');
const accountAvatar = document.getElementById('account-avatar');
const accountListAvatar = document.getElementById('account-list-avatar');
const accountListName = document.getElementById('account-list-name');
const accountProfileAvatar = document.getElementById('account-profile-avatar');
const accountProfileName = document.getElementById('account-profile-name');
const accountProfileEmail = document.getElementById('account-profile-email');
const accountNewWorkspace = document.getElementById('account-new-workspace');
const accountAdd = document.getElementById('account-add');
const accountLogout = document.getElementById('account-logout');
const accountAdmin = document.getElementById('account-admin');
const accountInvite = document.getElementById('account-invite');
const accountUpgrade = document.getElementById('account-upgrade');
const settingsOpen = document.getElementById('settings-open');
const profileOpen = document.getElementById('profile-open');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const profileModal = document.getElementById('profile-modal');
const profileClose = document.getElementById('profile-close');
const taskTypesOpen = document.getElementById('task-types-open');
const taskTypesModal = document.getElementById('task-types-modal');
const taskTypesClose = document.getElementById('task-types-close');
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
const noticeForm = document.getElementById('notice-form');
const noticeTitle = document.getElementById('notice-title');
const noticeType = document.getElementById('notice-type');
const noticeTypeNewRow = document.getElementById('notice-type-new-row');
const noticeTypeNewInput = document.getElementById('notice-type-new');
const noticeAt = document.getElementById('notice-at');
const noticeSaveBtn = document.getElementById('notice-save');
const noticeDismissBtn = document.getElementById('notice-dismiss');
const noticeCancel = document.getElementById('notice-cancel');
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
const taskEditor = document.getElementById('task-editor');
const taskEditorForm = document.getElementById('task-editor-form');
const editorTitle = document.getElementById('editor-title');
const editorType = document.getElementById('editor-type');
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
const editorParent = document.getElementById('editor-parent');
const templatePrompt = document.getElementById('template-prompt');
const templatePromptTitle = document.getElementById('template-prompt-title');
const templatePromptText = document.getElementById('template-prompt-text');
const templatePromptStart = document.getElementById('template-prompt-start');
const templatePromptDefer = document.getElementById('template-prompt-defer');
const templatePromptDismiss = document.getElementById('template-prompt-dismiss');
let openMenu = null;
let editingTemplateId = null;
let activeTaskId = null;
let templatePromptTaskId = null;
let taskModalDefaults = {};
let draggingTaskId = null;
let draggingTaskEl = null;
let draggingTaskOrigin = null;
let draggingColumnKey = null;
let draggingColumnEl = null;
let columnOrderDirty = false;
let suppressTaskClick = false;
let recurrenceContext = 'modal';
let modalRecurrence = { interval: null, unit: 'month' };
let editorRecurrence = { interval: null, unit: 'month' };
let syncInFlight = false;
let taskEditorSwapTimer = null;
let activeNoticeId = null;
let activeCheckinTaskId = null;
let checkinProgressTaskId = null;
let checkinRescheduleContext = null;
const checkinSnoozes = new Map();
let notesEditorView = null;
let notesEditorStateCtor = null;
let notesMarkdownParser = null;
let notesMarkdownSerializer = null;
let notesSchema = null;
let notesEditorPlugins = [];
let notesMode = notesEditorWrapper?.classList.contains('is-markdown') ? 'markdown' : 'rich';
let notesEditorInitPromise = null;
let pendingNotesContent = '';
let undoToastTimer = null;
let undoToastEl = null;

document.addEventListener('click', () => {
  if (openMenu) {
    openMenu.classList.add('hidden');
    openMenu = null;
  }
});

document.addEventListener('click', (event) => {
  if (!taskEditor || !taskEditor.classList.contains('is-open')) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#task-editor')) return;
  if (target.closest('.modal')) return;
  if (target.closest('.task-item') || target.closest('.kanban-card')) return;
  closeTaskEditor();
});

workspaceMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== workspaceMenu) {
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
  if (openMenu && openMenu !== workspaceListEl) {
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

taskFilterButton?.addEventListener('click', (event) => {
  event.stopPropagation();
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
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = filter === 'all' ? null : 'unassigned';
  setActiveView('tasks');
  taskFilterMenu.classList.add('hidden');
  openMenu = null;
  render();
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
tasksOpenBtn?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
noticesBackBtn?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
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
  const isAddNew = noticeType.value === '__add_new__';
  noticeTypeNewRow?.classList.toggle('hidden', !isAddNew);
  if (isAddNew) {
    noticeTypeNewInput?.focus();
  } else if (noticeTypeNewInput) {
    noticeTypeNewInput.value = '';
  }
});

noticeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = noticeTitle.value.trim();
  if (!title) return;
  const notifyAt = fromDatetimeLocal(noticeAt.value);
  if (!notifyAt) return;
  let typeValue = noticeType?.value ?? 'general';
  if (typeValue === '__add_new__') {
    const newLabel = noticeTypeNewInput?.value?.trim();
    if (!newLabel) return;
    const created = await createNoticeTypeRecord({ label: newLabel });
    typeValue = created?.key ?? newLabel.toLowerCase().replace(/\s+/g, '-');
  }
  if (activeNoticeId) {
    await updateNoticeRecord(activeNoticeId, { title, notify_at: notifyAt, notice_type: typeValue });
  } else {
    await createNoticeRecord({ title, notify_at: notifyAt, notice_type: typeValue });
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

function getNoticeTypeLabel(key) {
  const types = (state.noticeTypes ?? []).length ? state.noticeTypes : DEFAULT_NOTICE_TYPES;
  return types.find(type => type.key === key)?.label ?? 'General';
}

function getActiveView() {
  return state.ui?.activeView ?? 'tasks';
}

function setActiveView(view) {
  state.ui = state.ui ?? {};
  state.ui.activeView = view;
}

function getTaskView() {
  return state.ui?.taskView ?? 'list';
}

function setTaskView(view) {
  state.ui = state.ui ?? {};
  state.ui.taskView = view;
}

function getTaskSortKey() {
  return state.ui?.taskSort ?? 'default';
}

function setTaskSortKey(key) {
  state.ui = state.ui ?? {};
  state.ui.taskSort = key;
}

function getNoticeFilterKey() {
  return state.ui?.noticeFilter ?? 'all';
}

function setNoticeFilterKey(key) {
  state.ui = state.ui ?? {};
  state.ui.noticeFilter = key;
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
  if (hasPendingLocalChanges()) return;
  syncInFlight = true;
  try {
    const cursor = state.ui?.syncCursor ?? 0;
    const result = await api.pullChanges(state.workspace.id, cursor);
    if (result?.next_cursor !== undefined) {
      state.ui = state.ui ?? {};
      state.ui.syncCursor = result.next_cursor;
    }
    if (Array.isArray(result?.changes) && result.changes.length) {
      const hasWorkspaceChange = result.changes.some(change => change.entity_type === 'workspace');
      if (hasWorkspaceChange) {
        await reloadWorkspacesAndData();
      } else {
        await refreshWorkspace();
      }
      syncStatus.textContent = 'Auto-refreshed';
    }
  } catch {
    // ignore sync failures (offline OK)
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
  return getStatusByKey(key)?.label ?? key ?? 'Unknown';
}

function getStatusKind(key) {
  return getStatusByKey(key)?.kind ?? null;
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

function stringToHue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
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
  return STATUS_COLOR_MAP[key] ?? `hsl(${stringToHue(key ?? 'status')}, 60%, 55%)`;
}

function addInterval(date, interval, unit) {
  const next = new Date(date.getTime());
  if (unit === 'day') next.setDate(next.getDate() + interval);
  if (unit === 'week') next.setDate(next.getDate() + interval * 7);
  if (unit === 'month') next.setMonth(next.getMonth() + interval);
  if (unit === 'year') next.setFullYear(next.getFullYear() + interval);
  return next;
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
  openNoticeModalWithNotice(null);
}

function closeNoticeModal() {
  noticeModal?.classList.add('hidden');
  activeNoticeId = null;
  noticeTypeNewRow?.classList.add('hidden');
  if (noticeTypeNewInput) noticeTypeNewInput.value = '';
  noticeDismissBtn?.classList.add('hidden');
}

function openNoticeModalWithNotice(notice) {
  if (!noticeModal) return;
  activeNoticeId = notice?.id ?? null;
  noticeTitle.value = notice?.title ?? '';
  noticeAt.value = notice?.notify_at ? toDatetimeLocal(notice.notify_at) : '';
  renderNoticeTypeSelect(notice?.notice_type ?? 'general');
  noticeModal.querySelector('h2').textContent = notice ? 'Edit Notice' : 'New Notice';
  if (noticeSaveBtn) noticeSaveBtn.textContent = notice ? 'Save' : 'Create';
  noticeDismissBtn?.classList.toggle('hidden', !notice);
  noticeModal.classList.remove('hidden');
  noticeTitle.focus();
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
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type.key;
    option.textContent = type.label;
    noticeType.appendChild(option);
  });
  const addOption = document.createElement('option');
  addOption.value = '__add_new__';
  addOption.textContent = 'Add new type…';
  noticeType.appendChild(addOption);
  if (selectedKey && types.some(type => type.key === selectedKey)) {
    noticeType.value = selectedKey;
    noticeTypeNewRow?.classList.add('hidden');
  } else if (selectedKey) {
    noticeType.value = '__add_new__';
    noticeTypeNewRow?.classList.remove('hidden');
    if (noticeTypeNewInput) noticeTypeNewInput.value = selectedKey;
  } else {
    noticeType.value = types[0]?.key ?? 'general';
    noticeTypeNewRow?.classList.add('hidden');
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
  saveLocalData({
    localSeq: state.local?.localSeq ?? 0,
    pendingChanges: state.local?.pendingChanges ?? [],
    workspaces: state.workspaces ?? [],
    projects: state.projects ?? [],
    statuses: state.statuses ?? [],
    taskTypes: state.taskTypes ?? [],
    tasks: state.tasks ?? {},
    taskDependencies: state.taskDependencies ?? [],
    templates: state.templates ?? [],
    notices: state.notices ?? [],
    noticeTypes: state.noticeTypes ?? [],
    storeRules: state.storeRules ?? [],
    shoppingLists: state.shoppingLists ?? [],
    shoppingItems: state.shoppingItems ?? {}
  });
}

function queueLocalChange(change) {
  const updated = recordLocalChange({
    localSeq: state.local?.localSeq ?? 0,
    pendingChanges: state.local?.pendingChanges ?? []
  }, change);
  state.local.localSeq = updated.localSeq;
  state.local.pendingChanges = updated.pendingChanges;
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
}

async function loadWorkspaces() {
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
}

async function loadWorkspaceData() {
  if (!state.workspace) return;
  if (!hasPendingLocalChanges()) {
    try {
      state.projects = (await api.listProjects(state.workspace.id)).map(normalizeProject);
      state.templates = (await api.listTemplates(state.workspace.id)).map(normalizeTemplate);
      state.statuses = (await api.listStatuses(state.workspace.id)).map(normalizeStatus);
      state.taskTypes = (await api.listTaskTypes(state.workspace.id)).map(normalizeTaskType);
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
  ensureLocalWorkspaceDefaults(state.workspace);
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const preferredListId = state.ui?.activeShoppingListId;
  const availableLists = state.shoppingLists.filter(list => showArchived || !list.archived);
  const activeList = availableLists.find(list => list.id === preferredListId)
    ?? availableLists.find(list => !list.archived)
    ?? availableLists[0]
    ?? null;
  state.ui.activeShoppingListId = activeList?.id ?? null;
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
  state.ui.syncCursor = 0;
  setActiveView('tasks');
  await refreshWorkspace();
  await primeSyncCursor();
}

function normalizeWorkspace(workspace) {
  return { ...workspace, archived: Boolean(workspace.archived) };
}

function normalizeProject(project) {
  return { ...project, archived: Boolean(project.archived) };
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
  return {
    ...notice,
    notice_type: notice.notice_type ?? 'general',
    dismissed_at: notice.dismissed_at ?? null,
    notice_sent_at: notice.notice_sent_at ?? null
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

function normalizeTask(task) {
  return {
    ...task,
    auto_debit: Number(task.auto_debit) ? 1 : 0,
    template_prompt_pending: Number(task.template_prompt_pending) ? 1 : 0
  };
}

function upsertTask(task) {
  state.tasks[task.id] = normalizeTask(task);
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
  const statusKey = parentId ? null : (payload.status ?? getDefaultStatusKey());
  const sortOrder = payload.sort_order === undefined || payload.sort_order === null
    ? getNextTaskSortOrder(parentId, statusKey)
    : payload.sort_order;
  const taskPayload = {
    ...payload,
    sort_order: sortOrder,
    workspace_id: state.workspace.id
  };
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createTask(taskPayload);
      if (created) upsertTask(created);
      return created;
    } catch {
      // fall back to local create
    }
  }
  const now = new Date().toISOString();
  const status = taskPayload.status ?? getDefaultStatusKey();
  let localTask = normalizeTask({
    id: createId(),
    workspace_id: state.workspace.id,
    parent_id: taskPayload.parent_id ?? null,
    project_id: taskPayload.project_id ?? null,
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
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const updated = await api.updateTask(id, patch);
      if (updated) upsertTask(updated);
      return updated;
    } catch {
      // fall back to local update
    }
  }
  const existing = state.tasks[id];
  if (!existing) return null;
  let next = { ...existing, ...patch, updated_at: new Date().toISOString() };
  if (patch.status) {
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

async function createStatusRecord(label) {
  if (!state.workspace) return null;
  const created = await api.createStatus({ workspace_id: state.workspace.id, label });
  if (created) upsertStatus(created);
  return created;
}

async function updateStatusRecord(id, patch) {
  const updated = await api.updateStatus(id, patch);
  if (updated) upsertStatus(updated);
  return updated;
}

async function deleteStatusRecord(id) {
  const result = await api.deleteStatus(id);
  if (result?.deleted) {
    state.statuses = (state.statuses ?? []).filter(status => status.id !== id);
  }
  return result;
}

async function createTaskTypeRecord(name) {
  if (!state.workspace) return null;
  const created = await api.createTaskType({ workspace_id: state.workspace.id, name });
  if (created) upsertTaskType(created);
  return created;
}

async function updateTaskTypeRecord(id, patch) {
  const updated = await api.updateTaskType(id, patch);
  if (updated) upsertTaskType(updated);
  return updated;
}

async function deleteTaskTypeRecord(id) {
  const result = await api.deleteTaskType(id);
  if (result?.deleted) {
    state.taskTypes = (state.taskTypes ?? []).filter(type => type.id !== id);
  }
  return result;
}

async function createNoticeRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createNotice({ ...payload, workspace_id: state.workspace.id });
  if (created) upsertNotice(created);
  return created;
}

async function createNoticeTypeRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createNoticeType({ ...payload, workspace_id: state.workspace.id });
  if (created) upsertNoticeType(created);
  return created;
}

async function updateNoticeRecord(id, patch) {
  const updated = await api.updateNotice(id, patch);
  if (updated) upsertNotice(updated);
  return updated;
}

async function updateNoticeTypeRecord(id, patch) {
  const updated = await api.updateNoticeType(id, patch);
  if (updated) upsertNoticeType(updated);
  return updated;
}

async function deleteNoticeRecord(id) {
  const result = await api.deleteNotice(id);
  if (result?.deleted) {
    state.notices = (state.notices ?? []).filter(notice => notice.id !== id);
  }
  return result;
}

async function deleteNoticeTypeRecord(id) {
  const result = await api.deleteNoticeType(id);
  if (result?.deleted) {
    state.noticeTypes = (state.noticeTypes ?? []).filter(type => type.id !== id);
  }
  return result;
}

async function createStoreRuleRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createStoreRule({ ...payload, workspace_id: state.workspace.id });
  if (created) upsertStoreRule(created);
  return created;
}

async function updateStoreRuleRecord(id, patch) {
  const updated = await api.updateStoreRule(id, patch);
  if (updated) upsertStoreRule(updated);
  return updated;
}

async function deleteStoreRuleRecord(id) {
  const result = await api.deleteStoreRule(id);
  if (result?.deleted) {
    state.storeRules = (state.storeRules ?? []).filter(rule => rule.id !== id);
  }
  return result;
}

async function createShoppingListRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createShoppingList({ ...payload, workspace_id: state.workspace.id });
  if (created) upsertShoppingList(created);
  return created;
}

async function updateShoppingListRecord(id, patch) {
  const updated = await api.updateShoppingList(id, patch);
  if (updated) upsertShoppingList(updated);
  return updated;
}

async function deleteShoppingListRecord(id) {
  const result = await api.deleteShoppingList(id);
  if (result?.deleted) {
    state.shoppingLists = (state.shoppingLists ?? []).filter(list => list.id !== id);
    removeShoppingItemsForList(id);
  }
  return result;
}

async function createShoppingItemsRecord(listId, items) {
  if (!items.length) return [];
  const result = await api.createShoppingItems(listId, items);
  const createdItems = Array.isArray(result?.items) ? result.items : [];
  createdItems.forEach(item => upsertShoppingItem(item));
  return createdItems;
}

async function updateShoppingItemRecord(id, patch) {
  const updated = await api.updateShoppingItem(id, patch);
  if (updated) upsertShoppingItem(updated);
  return updated;
}

async function deleteShoppingItemRecord(id) {
  const result = await api.deleteShoppingItem(id);
  if (result?.deleted) {
    delete state.shoppingItems[id];
  }
  return result;
}

async function archiveShoppingListRecord(listId) {
  const updated = await updateShoppingListRecord(listId, { archived: 1 });
  if (!updated) return null;
  if (state.ui?.activeShoppingListId === listId) {
    const next = (state.shoppingLists ?? []).find(list => list.id !== listId && !list.archived);
    state.ui.activeShoppingListId = next?.id ?? null;
    if (!next) {
      setActiveView('tasks');
    }
  }
  return updated;
}

async function maybeAutoArchiveList(listId) {
  const list = (state.shoppingLists ?? []).find(item => item.id === listId);
  if (!list || list.archived) return;
  if (!isShoppingListComplete(listId)) return;
  await archiveShoppingListRecord(listId);
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
    button.disabled = !available || notesMode === 'markdown' || !notesEditorView;
  });
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
    notesEditorView.focus();
  }
  updateNotesToolbarState();
}

let notesToolbarBound = false;

function bindNotesToolbar(commands) {
  if (notesToolbarBound || !notesEditorWrapper) return;
  notesToolbarBound = true;
  const { toggleMark, setBlockType, wrapIn, wrapInList } = commands;

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
          if (!node) break;
          const nextLevel = Number.isFinite(level) && level > 0 ? level : 1;
          executed = setBlockType(node, { level: nextLevel })(state, dispatch);
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
          executed = wrapIn(node)(state, dispatch);
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

      const { EditorState, Plugin } = statePkg;
      const { EditorView } = viewPkg;
      const { schema, defaultMarkdownParser, defaultMarkdownSerializer } = markdownPkg;
      const { keymap } = keymapPkg;
      const { history, undo, redo } = historyPkg;
      const { baseKeymap, toggleMark, setBlockType, wrapIn } = commandsPkg;
      const { wrapInList, liftListItem, sinkListItem } = listPkg;

      notesEditorStateCtor = EditorState;
      notesSchema = schema;
      notesMarkdownParser = defaultMarkdownParser;
      notesMarkdownSerializer = defaultMarkdownSerializer;

      const plugins = [
        new Plugin({
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
        history(),
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-b': toggleMark(notesSchema.marks.strong),
          'Mod-i': toggleMark(notesSchema.marks.em),
          'Mod-`': toggleMark(notesSchema.marks.code)
        })
      ];

      if (notesSchema.nodes.list_item) {
        plugins.push(keymap({
          Tab: sinkListItem(notesSchema.nodes.list_item),
          'Shift-Tab': liftListItem(notesSchema.nodes.list_item)
        }));
      }

      plugins.push(keymap(baseKeymap));

      notesEditorPlugins = plugins;

      const markdown = editorDesc?.value ?? pendingNotesContent ?? '';
      const doc = createNotesDocFromMarkdown(markdown) ?? notesSchema.topNodeType.createAndFill();
      const state = EditorState.create({
        schema: notesSchema,
        doc,
        plugins
      });
      notesEditorView = new EditorView(editorNotesContainer, { state });

      bindNotesToolbar({ toggleMark, setBlockType, wrapIn, wrapInList });
      setNotesMode(notesMode || 'rich');
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

function detectStoreFromItems(items) {
  const rules = getStoreRulesForWorkspace();
  if (!rules.length || !items.length) return null;
  let best = null;
  let bestScore = 0;
  const normalizedItems = items.map(item => item.toLowerCase());
  rules.forEach(rule => {
    const keywords = (rule.keywords ?? []).map(word => word.toLowerCase()).filter(Boolean);
    if (!keywords.length) return;
    let score = 0;
    keywords.forEach(keyword => {
      if (normalizedItems.some(item => item.includes(keyword))) {
        score += 1;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = rule.store_name;
    }
  });
  return bestScore > 0 ? best : null;
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
    status: task.status ?? getDefaultStatusKey(),
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

async function persistTaskOrder(container, parentId, statusKey) {
  const items = getDirectTaskItems(container);
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].dataset.taskId;
    const task = state.tasks[id];
    if (!task) continue;
    const nextSort = (index + 1) * 10;
    if (task.sort_order === nextSort) continue;
    await updateTaskRecord(id, { sort_order: nextSort });
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

function attachTaskDropzone(container, { parentId = null, statusKey = null } = {}) {
  const normalizedParent = parentId ? parentId : null;
  container.dataset.parentId = normalizedParent ?? '';
  if (statusKey) {
    container.dataset.statusKey = statusKey;
  } else {
    delete container.dataset.statusKey;
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
    const originParent = draggingTaskOrigin?.parentId ?? null;
    const normalizedParent = parentId ? parentId : null;
    const movingToRoot = normalizedParent === null && originParent !== null;
    const draggingEl = document.querySelector(`.task-item[data-task-id="${draggingTaskId}"]`);
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
    if (draggingEl && targetContainer && (draggingEl.parentElement === targetContainer || movingToRoot)) {
      const addRow = targetContainer.querySelector('.task-add-task');
      if (addRow) {
        targetContainer.insertBefore(draggingEl, addRow);
      } else {
        targetContainer.appendChild(draggingEl);
      }
    }
    if (targetContainer) {
      await persistTaskOrder(targetContainer, parentId, statusKey);
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
    if (canReparentTask(task.id) && isSubtaskDropZone(event, item)) {
      event.preventDefault();
      item.classList.remove('drop-subtask');
      await handleSubtaskDrop(task.id);
      return;
    }
    item.classList.remove('drop-subtask');
    const container = item.parentElement;
    const parentId = container?.dataset?.parentId ?? null;
    const statusKey = container?.dataset?.statusKey ?? null;
    const allowed = canDropTaskInContainer(parentId ? parentId : null, statusKey ?? null);
    if (!allowed) return;
    event.preventDefault();
    const draggingEl = document.querySelector(`.task-item[data-task-id="${draggingTaskId}"]`);
    if (!draggingEl || draggingEl === item) return;
    const originParent = draggingTaskOrigin?.parentId ?? null;
    const normalizedParent = parentId ? parentId : null;
    const movingToRoot = normalizedParent === null && originParent !== null;
    if (draggingEl.parentElement !== container) {
      if (!movingToRoot) return;
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
    const rect = item.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(draggingEl, insertAfter ? item.nextSibling : item);
    await persistTaskOrder(container, parentId ? parentId : null, statusKey ?? null);
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

function getTaskSortComparator() {
  const key = getTaskSortKey();
  if (key === 'due-asc') {
    return (a, b) => compareTasksByDueDate(a, b, 'asc');
  }
  if (key === 'due-desc') {
    return (a, b) => compareTasksByDueDate(a, b, 'desc');
  }
  return compareTasksByPriority;
}

function render() {
  renderWorkspaceList();
  renderAccountMenu();
  renderProjectList();
  renderTemplateList();
  renderTaskTypeList();
  renderStoreRuleList();
  renderWorkspaceManageList();
  renderWorkspaceArchivedList();
  renderShoppingListList();
  renderNoticeSidebarList();
  renderNoticesPageList();
  renderNoticeBellMenu();
  renderTaskFilter();
  renderTaskSort();
  renderNoticeFilter();
  renderNoticeSort();
  renderTaskViewToggle();
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
  if (view === 'kanban') {
    sortTree(tree, compareTasksByPriority);
    renderKanban(tree);
  } else if (view === 'calendar') {
    renderCalendarView(tasks);
  } else {
    sortTree(tree, getTaskSortComparator());
    renderTaskList(tree);
  }
  renderShoppingPanel();
  renderView();
  if (taskColumnsModal && !taskColumnsModal.classList.contains('hidden')) {
    renderTaskColumnsModal();
  }
  if (noticeModal && !noticeModal.classList.contains('hidden')) {
    renderNoticeTypeSelect(noticeType?.value ?? '');
  }
  renderNotificationStatus();
  if (checkinDefaultMinutesInput) {
    const activeEl = document.activeElement;
    if (activeEl !== checkinDefaultMinutesInput) {
      checkinDefaultMinutesInput.value = String(getCheckinExtendMinutes());
    }
  }
  if (checkinNoModal && !checkinNoModal.classList.contains('hidden') && checkinNoExtend) {
    checkinNoExtend.textContent = `Extend session (${getCheckinExtendMinutes()} min)`;
  }
  syncCheckinModal();
  maybeShowCheckinModal();
  saveState(state);
  persistLocalData();
}

function renderView() {
  const view = getActiveView();
  const showTasks = view === 'tasks';
  const showShopping = view === 'shopping';
  const showNotices = view === 'notices';
  const showManageWorkspaces = view === 'workspaces-manage';
  const showArchivedWorkspaces = view === 'workspaces-archived';

  tasksPanel?.classList.toggle('hidden', !showTasks);
  shoppingPage?.classList.toggle('hidden', !showShopping);
  noticesPage?.classList.toggle('hidden', !showNotices);
  workspaceManagePage?.classList.toggle('hidden', !showManageWorkspaces);
  workspaceArchivedPage?.classList.toggle('hidden', !showArchivedWorkspaces);
}

function getProjectsForWorkspace() {
  if (!state.workspace) return [];
  return (state.projects ?? []).filter(project => project.workspace_id === state.workspace.id && !project.archived);
}

function getActiveShoppingList() {
  if (!state.workspace) return null;
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const lists = (state.shoppingLists ?? []).filter(list =>
    list.workspace_id === state.workspace.id && (showArchived || !list.archived)
  );
  const activeId = state.ui?.activeShoppingListId ?? null;
  return lists.find(list => list.id === activeId)
    ?? lists.find(list => !list.archived)
    ?? lists[0]
    ?? null;
}

function getShoppingItemsForList(listId) {
  if (!listId) return [];
  return Object.values(state.shoppingItems ?? {}).filter(item => item.list_id === listId);
}

function isShoppingListComplete(listId) {
  const items = getShoppingItemsForList(listId);
  if (!items.length) return false;
  return items.every(item => item.is_checked);
}

function getFilteredTasks() {
  if (!state.workspace) return [];
  const tasks = Object.values(state.tasks).filter(task => task.workspace_id === state.workspace.id);
  const filter = state.ui?.activeProjectId ?? null;
  if (!filter) return tasks;
  if (filter === 'unassigned') {
    return tasks.filter(task => !task.project_id);
  }
  return tasks.filter(task => task.project_id === filter);
}

function renderTaskFilter() {
  if (!taskFilterButton || !taskFilterMenu) return;
  const active = state.ui?.activeProjectId ?? null;
  let label = 'All tasks';
  if (active === 'unassigned') {
    label = 'Unassigned';
  } else if (active) {
    const project = (state.projects ?? []).find(item => item.id === active);
    label = project?.name ?? 'All tasks';
  }
  taskFilterButton.textContent = `${label} ▾`;
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

function renderNoticeFilter() {
  if (!noticeFilterButton || !noticeFilterMenu) return;
  const key = getNoticeFilterKey();
  const labelMap = {
    all: 'All notices',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    today: 'Today'
  };
  noticeFilterButton.textContent = `${labelMap[key] ?? 'All notices'} ▾`;
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

function getAccountInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'BH';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function renderAccountMenu() {
  const name = getAccountDisplayName();
  const initials = getAccountInitials(name);
  const email = 'you@example.com';
  [accountAvatar, accountListAvatar, accountProfileAvatar].forEach((el) => {
    if (el) el.textContent = initials;
  });
  if (accountListName) accountListName.textContent = name;
  if (accountProfileName) accountProfileName.textContent = name;
  if (accountProfileEmail) accountProfileEmail.textContent = email;
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

function renderProjectList() {
  if (!projectListEl) return;
  if (!state.workspace) {
    projectListEl.innerHTML = '';
    return;
  }
  projectListEl.innerHTML = '';
  const active = state.ui?.activeProjectId ?? null;
  if (active && active !== 'unassigned') {
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
      state.ui = state.ui ?? {};
      state.ui.activeProjectId = project.id;
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
      const updated = await api.updateProject(project.id, { name: updatedName });
      if (updated) upsertProject(updated);
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
      const updated = await api.updateProject(project.id, { archived: 1 });
      if (updated) upsertProject(updated);
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
      await api.deleteProject(project.id);
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

function populateProjectSelect(selectEl, selectedId = null, includeNone = true) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  if (includeNone) {
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    selectEl.appendChild(noneOption);
  }
  getProjectsForWorkspace().forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
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
  if (taskId) {
    disallowed.add(taskId);
    getDescendants(taskId).forEach(task => disallowed.add(task.id));
  }
  const candidates = Object.values(state.tasks ?? {})
    .filter(task => task.workspace_id === state.workspace.id && !disallowed.has(task.id))
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
  statuses.forEach(status => {
    const option = document.createElement('option');
    option.value = status.key;
    option.textContent = status.label;
    selectEl.appendChild(option);
  });
  const fallback = selectedKey ?? getDefaultStatusKey();
  selectEl.value = statuses.some(status => status.key === fallback) ? fallback : (statuses[0]?.key ?? '');
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
    meta.textContent = `${getNoticeTypeLabel(notice.notice_type)} · ${dateText}`;
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
      openNoticeModalWithNotice(notice);
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

function renderNoticesPageList() {
  if (!noticesListEl) return;
  if (!state.workspace) {
    noticesListEl.innerHTML = '';
    return;
  }
  noticesListEl.innerHTML = '';
  const now = new Date();
  let notices = (state.notices ?? [])
    .filter(notice => notice.workspace_id === state.workspace.id && !notice.dismissed_at);

  const filterKey = getNoticeFilterKey();
  notices = notices.filter(notice => {
    if (!notice.notify_at) return filterKey === 'all';
    const notifyAt = new Date(notice.notify_at);
    if (Number.isNaN(notifyAt.getTime())) return filterKey === 'all';
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
    empty.textContent = 'No notices yet.';
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
    meta.textContent = `${getNoticeTypeLabel(notice.notice_type)} · ${dateText}`;
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
      openNoticeModalWithNotice(notice);
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
    list.workspace_id === state.workspace.id && (showArchived || !list.archived)
  );
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
    selectBtn.textContent = list.archived ? `${list.name} (archived)` : list.name;
    selectBtn.addEventListener('click', () => {
      state.ui.activeShoppingListId = list.id;
      setActiveView('shopping');
      render();
    });

    row.appendChild(selectBtn);
    shoppingListListEl.appendChild(row);
  });
}

function renderShoppingPanel() {
  if (!shoppingPage) return;
  const activeList = getActiveShoppingList();
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
  shoppingListTitle.textContent = activeList.name;
  const items = getShoppingItemsForList(activeList.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const complete = isShoppingListComplete(activeList.id);
  shoppingListSubtitle.textContent = `${items.length} items${complete ? ' · complete' : ''}${activeList.archived ? ' · archived' : ''}`;
  shoppingListMenuButton?.classList.remove('hidden');
  shoppingCompleteBtn?.classList.remove('hidden');
  shoppingAddBtn?.classList.remove('hidden');
  if (shoppingCompleteBtn) {
    shoppingCompleteBtn.disabled = items.length === 0;
  }
  if (activeList.archived) {
    shoppingAddBtn?.classList.add('hidden');
    shoppingCompleteBtn.disabled = true;
  }

  shoppingListItemsEl.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shopping-item' + (item.is_checked ? ' is-checked' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.is_checked);
    checkbox.addEventListener('change', async () => {
      await updateShoppingItemRecord(item.id, { is_checked: checkbox.checked ? 1 : 0 });
      await maybeAutoArchiveList(activeList.id);
      render();
    });

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

    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(deleteBtn);
    shoppingListItemsEl.appendChild(row);
  });
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'No items yet. Add a few below.';
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
  const header = document.createElement('div');
  header.className = 'task-list-header';
  header.textContent = 'Name';
  taskTreeEl.appendChild(header);

  const topDropzone = document.createElement('div');
  topDropzone.className = 'task-root-dropzone';
  attachTaskDropzone(topDropzone, { parentId: null });
  taskTreeEl.appendChild(topDropzone);

  const list = document.createElement('div');
  list.className = 'task-list';
  attachTaskDropzone(list, { parentId: null });
  roots.forEach(node => list.appendChild(renderTask(node)));
  const addRow = document.createElement('div');
  addRow.className = 'task-add-subtask task-add-task';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'task-add-input';
  addInput.placeholder = 'Add task...';
  addInput.value = state.ui?.taskAddDraft ?? '';
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
  list.appendChild(addRow);
  taskTreeEl.appendChild(list);

  const bottomDropzone = document.createElement('div');
  bottomDropzone.className = 'task-root-dropzone';
  attachTaskDropzone(bottomDropzone, { parentId: null });
  taskTreeEl.appendChild(bottomDropzone);

  if (state.ui?.focusTaskAdd || state.ui?.taskAddFocused) {
    state.ui = state.ui ?? {};
    state.ui.focusTaskAdd = false;
    state.ui.taskAddFocused = true;
    setTimeout(() => addInput.focus(), 0);
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

function setCalendarMonth(date) {
  state.ui = state.ui ?? {};
  const month = String(date.getMonth() + 1).padStart(2, '0');
  state.ui.calendarMonth = `${date.getFullYear()}-${month}`;
}

function getCalendarIncludeNotices() {
  return Boolean(state.ui?.calendarIncludeNotices);
}

function setCalendarIncludeNotices(value) {
  state.ui = state.ui ?? {};
  state.ui.calendarIncludeNotices = Boolean(value);
}

function renderCalendarView(tasks) {
  const monthDate = getCalendarMonth();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const header = document.createElement('div');
  header.className = 'calendar-header';
  const title = document.createElement('div');
  title.className = 'calendar-title';
  title.textContent = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const controls = document.createElement('div');
  controls.className = 'calendar-controls';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'icon-button';
  prevBtn.textContent = '‹';
  prevBtn.title = 'Previous month';
  prevBtn.addEventListener('click', () => {
    const prev = new Date(year, month - 1, 1);
    setCalendarMonth(prev);
    render();
  });
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'icon-button';
  nextBtn.textContent = '›';
  nextBtn.title = 'Next month';
  nextBtn.addEventListener('click', () => {
    const next = new Date(year, month + 1, 1);
    setCalendarMonth(next);
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
  includeText.textContent = 'Include notices';
  includeLabel.appendChild(includeCheckbox);
  includeLabel.appendChild(includeText);
  controls.appendChild(prevBtn);
  controls.appendChild(nextBtn);
  controls.appendChild(includeLabel);
  header.appendChild(title);
  header.appendChild(controls);
  taskTreeEl.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  weekdayLabels.forEach(label => {
    const cell = document.createElement('div');
    cell.className = 'calendar-weekday';
    cell.textContent = label;
    grid.appendChild(cell);
  });

  const entriesByDate = new Map();
  tasks.forEach(task => {
    if (!task.due_at) return;
    const due = new Date(task.due_at);
    if (Number.isNaN(due.getTime())) return;
    const key = due.toISOString().slice(0, 10);
    const list = entriesByDate.get(key) ?? [];
    list.push({ type: 'task', id: task.id, title: task.title });
    entriesByDate.set(key, list);
  });

  if (getCalendarIncludeNotices()) {
    (state.notices ?? []).forEach(notice => {
      if (notice.dismissed_at) return;
      const date = new Date(notice.notify_at);
      if (Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      const list = entriesByDate.get(key) ?? [];
      list.push({ type: 'notice', id: notice.id, title: notice.title });
      entriesByDate.set(key, list);
    });
  }

  for (let i = 0; i < startOffset; i += 1) {
    const empty = document.createElement('div');
    empty.className = 'calendar-day empty';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, month, day);
    const key = date.toISOString().slice(0, 10);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    const dayLabel = document.createElement('div');
    dayLabel.className = 'calendar-day-number';
    dayLabel.textContent = String(day);
    cell.appendChild(dayLabel);
    const items = entriesByDate.get(key) ?? [];
    items.slice(0, 4).forEach(entry => {
      const item = document.createElement('div');
      item.className = `calendar-item ${entry.type}`;
      item.textContent = entry.title;
      if (entry.type === 'task') {
        item.addEventListener('click', () => openTaskEditor(entry.id));
      } else {
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
    grid.appendChild(cell);
  }

  taskTreeEl.appendChild(grid);
}

function renderKanban(roots) {
  const grouped = new Map();
  roots.forEach(task => {
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

    actions.appendChild(addButton);
    actions.appendChild(menuWrapper);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'kanban-cards';
    attachKanbanDropzone(list, status.key);
    if (state.ui?.kanbanQuickAdd === status.key) {
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
        const activeProjectId = state.ui?.activeProjectId ?? null;
        const projectId = activeProjectId && activeProjectId !== 'unassigned' ? activeProjectId : null;
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
  card.addEventListener('dblclick', () => {
    if (suppressTaskClick) return;
    openTaskEditor(task.id);
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
      const updatedName = nextName.trim();
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

function renderTask(task) {
  const template = document.getElementById('task-item-template');
  const node = template.content.cloneNode(true);
  const item = node.querySelector('.task-item');
  const titleEl = node.querySelector('.task-title');
  const metaEl = node.querySelector('.task-meta');
  const statusTag = node.querySelector('.task-status-tag');
  const typeBadge = node.querySelector('.task-type-badge');
  const toggleBtn = node.querySelector('.task-toggle');
  const completeButton = node.querySelector('.task-complete-button');
  const menuButton = node.querySelector('.task-menu-button');
  const menu = node.querySelector('.task-menu');
  const menuItems = node.querySelectorAll('.task-menu-item');
  const childrenEl = node.querySelector('.task-children');
  const hasChildren = task.children && task.children.length > 0;
  const collapsedMap = state.ui?.collapsedTasks ?? {};
  const isCollapsed = Boolean(collapsedMap[task.id]);
  const statusKey = task.status ?? getDefaultStatusKey();

  titleEl.textContent = task.title;
  item.dataset.status = statusKey;
  attachTaskDragHandlers(item, task);
  item.style.borderLeft = `3px solid ${getStatusColor(statusKey)}`;
  if (statusTag) {
    statusTag.textContent = getStatusLabel(statusKey);
    statusTag.style.background = `${getStatusColor(statusKey)}33`;
    statusTag.style.color = getStatusColor(statusKey);
  }
  const projectName = getProjectName(task.project_id);
  const projectText = projectName ? ` · ${projectName}` : '';
  const childCount = countDescendants(task);
  const childText = childCount ? ` · ${childCount} subtask${childCount > 1 ? 's' : ''}` : '';
  const waitingText = isWaitingStatusKey(statusKey) ? ` · ${formatFollowupMeta(task)}` : '';
  metaEl.textContent = `priority ${task.priority}${projectText}${childText}${waitingText}`;
  const recurrenceText = task.recurrence_interval && task.recurrence_unit
    ? ` · repeats every ${task.recurrence_interval} ${task.recurrence_unit}${task.recurrence_interval > 1 ? 's' : ''}`
    : '';
  const hasReminder = task.reminder_offset_days !== null && task.reminder_offset_days !== undefined;
  const reminderText = hasReminder ? ` · reminds ${task.reminder_offset_days}d before` : '';
  if (recurrenceText || reminderText) {
    metaEl.textContent += `${recurrenceText}${reminderText}`;
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

  item.addEventListener('dblclick', (event) => {
    if (suppressTaskClick) return;
    if (event.target.closest('button')) return;
    openTaskEditor(task.id);
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

  attachTaskDropzone(childrenEl, { parentId: task.id });

  completeButton.addEventListener('click', async () => {
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
    } else {
      menu.classList.add('hidden');
      openMenu = null;
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
        await createTaskRecord({ title, parent_id: task.id, project_id: task.project_id ?? null });
        render();
      }
      if (action === 'duplicate') {
        await createTaskRecord({
          title: `${task.title} (copy)`,
          parent_id: task.parent_id,
          project_id: task.project_id ?? null,
          priority: task.priority,
          status: getDefaultStatusKey(),
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

  task.children.forEach(child => childrenEl.appendChild(renderTask(child)));

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

function formatTemplateSteps(steps = []) {
  return steps
    .map(step => step.offset_days !== null && step.offset_days !== undefined
      ? `${step.title} | ${step.offset_days}`
      : step.title
    )
    .join('\n');
}

function openTemplateModal(template = null) {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
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
  openSettings();
}

function openSettings() {
  settingsModal?.classList.remove('hidden');
}

function closeSettings() {
  settingsModal?.classList.add('hidden');
}

function openProfile() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettings();
  }
  profileModal?.classList.remove('hidden');
}

function closeProfile() {
  profileModal?.classList.add('hidden');
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
  if (selectedName && storeNames.includes(selectedName)) {
    shoppingListStoreSelect.value = selectedName;
    shoppingListStoreNewRow?.classList.add('hidden');
  } else if (selectedName) {
    shoppingListStoreSelect.value = '__add_new__';
    shoppingListStoreNewRow?.classList.remove('hidden');
    if (shoppingListStoreNew) shoppingListStoreNew.value = selectedName;
  } else {
    shoppingListStoreSelect.value = '';
    shoppingListStoreNewRow?.classList.add('hidden');
  }
}

function openShoppingListModal() {
  if (shoppingListStoreSelect) {
    renderShoppingStoreSelect('');
  }
  if (shoppingListStoreNew) shoppingListStoreNew.value = '';
  shoppingListStoreNewRow?.classList.add('hidden');
  if (shoppingListDate) {
    shoppingListDate.value = new Date().toISOString().slice(0, 10);
  }
  shoppingListItemsInput.value = '';
  shoppingListModal.classList.remove('hidden');
  shoppingListStoreSelect?.focus();
}

function closeShoppingListModal() {
  shoppingListModal.classList.add('hidden');
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
  editorTitle.value = task.title ?? '';
  populateTaskTypeSelect(editorType, task.type_label ?? '');
  editorPriority.value = task.priority ?? 'medium';
  populateProjectSelect(editorProject, task.project_id ?? '', true);
  populateParentSelect(editorParent, task.id, task.parent_id ?? null);
  setRecurrenceState('editor', task.recurrence_interval ?? null, task.recurrence_unit ?? 'month');
  editorReminder.value = task.reminder_offset_days ?? '';
  populateStatusSelect(editorStatus, task.status ?? getDefaultStatusKey());
  updateEditorFollowupVisibility(editorStatus.value);
  const followupValue = task.waiting_followup_at ?? task.next_checkin_at ?? null;
  setEditorFollowupValue(followupValue);
  editorStart.value = toDatetimeLocal(task.start_at);
  editorDue.value = toDatetimeLocal(task.due_at);
  setNotesContent(task.description_md ?? '');
  renderTaskEditorSubtasks(task);
  renderTaskEditorDependencies(task);
  populateDependencySelect(task);
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
    meta.textContent = getStatusLabel(subtask.status ?? getDefaultStatusKey());
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
}

function closeTaskEditor() {
  taskEditor.classList.remove('is-open');
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
    await updateTaskRecord(task.id, { reminder_sent_at: nowIso() });
  }
  for (const notice of state.notices ?? []) {
    if (!shouldNotifyNotice(notice)) continue;
    new Notification('BrianHub Notice', {
      body: notice.title,
      tag: notice.id
    });
    await updateNoticeRecord(notice.id, { notice_sent_at: nowIso() });
  }
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
  const defaultStatus = taskModalDefaults.status ?? getDefaultStatusKey();
  populateStatusSelect(modalStatus, defaultStatus);
  modalStart.value = '';
  modalDue.value = '';
  modalDesc.value = '';
  const defaultType = taskModalDefaults.type_label ?? getDefaultTaskTypeName();
  populateTaskTypeSelect(modalType, defaultType);
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

modalCancel.addEventListener('click', closeTaskModal);
taskModal.querySelector('.modal-backdrop').addEventListener('click', closeTaskModal);

newShoppingListBtn?.addEventListener('click', openShoppingListModal);
shoppingListCancel?.addEventListener('click', closeShoppingListModal);
shoppingListModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShoppingListModal);
shoppingBack?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
workspaceManageBack?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
workspaceArchivedBack?.addEventListener('click', () => {
  setActiveView('tasks');
  render();
});
shoppingAddBtn?.addEventListener('click', openShoppingItemModal);
shoppingItemCancel?.addEventListener('click', closeShoppingItemModal);
shoppingItemModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShoppingItemModal);

shoppingListStoreSelect?.addEventListener('change', () => {
  if (!shoppingListStoreSelect) return;
  const isAddNew = shoppingListStoreSelect.value === '__add_new__';
  shoppingListStoreNewRow?.classList.toggle('hidden', !isAddNew);
  if (isAddNew) {
    shoppingListStoreNew?.focus();
  } else if (shoppingListStoreNew) {
    shoppingListStoreNew.value = '';
  }
});

shoppingListParse?.addEventListener('click', () => {
  const parsed = parseShoppingListInput(shoppingListItemsInput.value);
  const items = parsed.items ?? [];
  shoppingListItemsInput.value = items.length
    ? items.join('\n')
    : normalizeShoppingItems(shoppingListItemsInput.value);
  const currentStore = shoppingListStoreSelect?.value ?? '';
  if ((!currentStore || currentStore === '__add_new__') && parsed.title) {
    const parsedMeta = parseStoreAndDateFromTitle(parsed.title);
    if (parsedMeta.store) {
      renderShoppingStoreSelect(parsedMeta.store);
    }
    if (parsedMeta.date && shoppingListDate) {
      shoppingListDate.value = parsedMeta.date;
    }
  }
});

shoppingItemParse?.addEventListener('click', () => {
  shoppingItemInput.value = normalizeShoppingItems(shoppingItemInput.value);
});

shoppingListForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const parsed = parseShoppingListInput(shoppingListItemsInput.value);
  const items = parsed.items ?? [];
  let store = '';
  if (shoppingListStoreSelect) {
    if (shoppingListStoreSelect.value === '__add_new__') {
      store = shoppingListStoreNew?.value?.trim() ?? '';
    } else {
      store = shoppingListStoreSelect.value?.trim() ?? '';
    }
  }
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
  if (store && shoppingListStoreSelect?.value === '__add_new__') {
    const existing = getStoreNames().some(name => name.toLowerCase() === store.toLowerCase());
    if (!existing) {
      try {
        await createStoreRuleRecord({ store_name: store, keywords: [] });
      } catch (err) {
        alert(err?.message ?? 'Unable to add store.');
      }
    }
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
  const confirmed = confirm(`Delete shopping list \"${activeList.name}\"?`);
  if (!confirmed) return;
  await deleteShoppingListRecord(activeList.id);
  if (state.ui?.activeShoppingListId === activeList.id) {
    const next = (state.shoppingLists ?? []).find(list => !list.archived);
    state.ui.activeShoppingListId = next?.id ?? null;
  }
  shoppingListMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

shoppingCompleteBtn?.addEventListener('click', async () => {
  const activeList = getActiveShoppingList();
  if (!activeList) return;
  const items = getShoppingItemsForList(activeList.id);
  if (!items.length) return;
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
  await archiveShoppingListRecord(activeList.id);
  render();
});

settingsOpen?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  openSettings();
});
settingsClose?.addEventListener('click', closeSettings);
settingsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
profileOpen?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  openProfile();
});
profileClose?.addEventListener('click', closeProfile);
profileModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeProfile);
accountNewWorkspace?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  newWorkspaceBtn?.click();
});
accountAdd?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  alert('Add another account is coming soon.');
});
accountLogout?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  alert('Log out is coming soon.');
});
accountAdmin?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  alert('Admin console is coming soon.');
});
accountInvite?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  alert('Invites are coming soon.');
});
accountUpgrade?.addEventListener('click', () => {
  accountMenu?.classList.add('hidden');
  openMenu = null;
  alert('Upgrade options are coming soon.');
});
taskTypesOpen?.addEventListener('click', openTaskTypesModal);
taskTypesClose?.addEventListener('click', closeTaskTypesModal);
taskTypesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTaskTypesModal);
storeRulesOpen?.addEventListener('click', openStoreRulesModal);
storeRulesClose?.addEventListener('click', closeStoreRulesModal);
storeRulesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeStoreRulesModal);

editorCancel?.addEventListener('click', closeTaskEditor);
editorClose?.addEventListener('click', closeTaskEditor);
editorStatus?.addEventListener('change', () => {
  updateEditorFollowupVisibility(editorStatus.value);
  if (isWaitingStatusKey(editorStatus.value) && editorFollowup && !editorFollowup.value) {
    const next = addInterval(new Date(), 3, 'day');
    editorFollowup.value = toDatetimeLocal(next.toISOString());
  }
});
editorFollowupNow?.addEventListener('click', () => {
  ensureEditorWaitingStatus();
  setEditorFollowupValue(new Date().toISOString());
});
editorFollowupSnooze?.addEventListener('click', () => {
  ensureEditorWaitingStatus();
  const next = addInterval(new Date(), 3, 'day');
  setEditorFollowupValue(next.toISOString());
});
editorFollowupClear?.addEventListener('click', () => {
  if (editorFollowup) editorFollowup.value = '';
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
  const recurrence = editorRecurrence ?? { interval: null, unit: null };
  const patch = {
    type_label: typeLabel,
    title,
    description_md: description,
    priority: editorPriority.value,
    project_id: editorProject.value || null,
    recurrence_interval: recurrence.interval ?? null,
    recurrence_unit: recurrence.interval ? recurrence.unit : null,
    reminder_offset_days: parseInt(editorReminder.value, 10) || null,
    auto_debit: task.auto_debit ?? 0,
    start_at: fromDatetimeLocal(editorStart.value),
    due_at: fromDatetimeLocal(editorDue.value),
    status: nextStatus
  };
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
  const parentId = taskModalDefaults.parent_id ?? null;
  const activeProjectId = state.ui?.activeProjectId;
  const projectId = activeProjectId && activeProjectId !== 'unassigned' ? activeProjectId : null;
  const recurrence = modalRecurrence ?? { interval: null, unit: null };
  await createTaskRecord({
    title,
    parent_id: parentId,
    project_id: projectId,
    priority: modalPriority.value,
    status: modalStatus.value,
    type_label: typeLabel,
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


newTemplateBtn?.addEventListener('click', () => openTemplateModal(null));
templateCancel?.addEventListener('click', closeTemplateModal);
templateModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTemplateModal);

templateModalForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = templateName.value.trim();
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

syncBtn.addEventListener('click', async () => {
  if (hasPendingLocalChanges()) {
    syncStatus.textContent = 'Local changes pending (offline)';
    return;
  }
  syncStatus.textContent = 'Refreshing...';
  try {
    await refreshWorkspace();
    await primeSyncCursor();
    syncStatus.textContent = 'Synced (local)';
  } catch (err) {
    syncStatus.textContent = 'Sync failed (offline OK)';
  }
});

newWorkspaceBtn.addEventListener('click', async () => {
  workspaceMenu?.classList.add('hidden');
  openMenu = null;
  const name = prompt('Workspace name');
  if (!name) return;
  const trimmed = name.trim();
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
  const project = await api.createProject({ name: name.trim(), workspace_id: state.workspace.id, kind: 'project' });
  if (!project) return;
  upsertProject(project);
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = project.id;
  render();
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
    render();
    return;
  }
  const permission = await Notification.requestPermission();
  state.ui = state.ui ?? {};
  state.ui.notificationsEnabled = permission === 'granted';
  render();
});

setInterval(checkNotices, 60 * 1000);
setInterval(maybeShowCheckinModal, 60 * 1000);

async function init() {
  initNotesEditor();
  await loadWorkspaces();
  await refreshWorkspace();
  await primeSyncCursor();
  checkNotices();
  maybeShowCheckinModal();
}

init();

setInterval(() => {
  if (document.hidden) return;
  autoRefreshOnChanges();
}, 5000);
