import { loadState, saveState, createId } from './localStore.js';
import { loadLocalData, saveLocalData, recordLocalChange } from './localData.js';
import { applyRemoteChanges } from './syncState.js';
import { replayPendingChanges } from './syncQueue.js';
import { getClientId } from './clientId.js';
import { showToast } from './ui/toast.js';
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
  workflows: localData.workflows ?? [],
  workflowVariants: localData.workflowVariants ?? [],
  workflowPhases: localData.workflowPhases ?? [],
  workflowVariantPhases: localData.workflowVariantPhases ?? [],
  workflowPhaseTasks: localData.workflowPhaseTasks ?? [],
  workflowPatterns: localData.workflowPatterns ?? localData.workflowFragments ?? [],
  workflowPatternTasks: localData.workflowPatternTasks ?? localData.workflowFragmentTasks ?? [],
  workflowInstances: localData.workflowInstances ?? [],
  workflowInstanceTasks: localData.workflowInstanceTasks ?? [],
  statuses: localData.statuses ?? [],
  taskTypes: localData.taskTypes ?? [],
  users: localData.users ?? [],
  workspaceMemberships: localData.workspaceMemberships ?? [],
  taskSections: localData.taskSections ?? [],
  storeRules: localData.storeRules ?? [],
  tasks: localData.tasks ?? {},
  taskDependencies: localData.taskDependencies ?? [],
  notices: localData.notices ?? [],
  noticeTypes: localData.noticeTypes ?? [],
  shoppingLists: localData.shoppingLists ?? [],
  shoppingItems: localData.shoppingItems ?? {},
  auditLog: localData.auditLog ?? [],
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
const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const TASK_FILTER_UNASSIGNED = 'unassigned';
const TASK_FILTER_INBOX = '__inbox__';

function normalizeTitleInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const taskTreeEl = document.getElementById('task-tree');
const taskFilterButton = document.getElementById('task-filter-button');
const taskFilterMenu = document.getElementById('task-filter-menu');
const taskFilterSearchInput = document.getElementById('task-filter-search-input');
const taskToolsButton = document.getElementById('task-tools-button');
const taskToolsMenu = document.getElementById('task-tools-menu');
const taskToolsToggleQuickAdd = document.getElementById('task-tools-toggle-quick-add');
const taskToolsMobileFilter = document.getElementById('task-tools-mobile-filter');
const taskToolsMobileSort = document.getElementById('task-tools-mobile-sort');
const taskToolsMobileGroup = document.getElementById('task-tools-mobile-group');
const taskToolsMobileView = document.getElementById('task-tools-mobile-view');
const taskAiButton = document.getElementById('task-ai-button');
const taskAiMenu = document.getElementById('task-ai-menu');
const taskSortButton = document.getElementById('task-sort-button');
const taskSortMenu = document.getElementById('task-sort-menu');
const taskGroupButton = document.getElementById('task-group-button');
const taskGroupMenu = document.getElementById('task-group-menu');
const taskViewSelect = document.getElementById('task-view-select');
const taskColumnsButton = document.getElementById('task-columns-button');
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
const appTitle = document.getElementById('app-title');
const mobileTopMenuButton = document.getElementById('mobile-top-menu-button');
const mobileTopMenu = document.getElementById('mobile-top-menu');
const mobileMenuNotices = document.getElementById('mobile-menu-notices');
const mobileMenuSettings = document.getElementById('mobile-menu-settings');
const mobileMenuProfile = document.getElementById('mobile-menu-profile');
const mobileMenuWorkspaces = document.getElementById('mobile-menu-workspaces');
const mobileMenuAuth = document.getElementById('mobile-menu-auth');
const mobileNav = document.getElementById('mobile-nav');
const mobileNavButtons = Array.from(document.querySelectorAll('.mobile-nav-button[data-view]'));
const mobileNavAdd = document.getElementById('mobile-nav-add');
const mobileCreateSheet = document.getElementById('mobile-create-sheet');
const mobileCreateSheetBackdrop = document.getElementById('mobile-create-sheet-backdrop');
const mobileCreateSheetClose = document.getElementById('mobile-create-sheet-close');
const mobileCreateTask = document.getElementById('mobile-create-task');
const mobileCreateNotice = document.getElementById('mobile-create-notice');
const mobileCreateWorkflow = document.getElementById('mobile-create-workflow');
const mobileCreateShopping = document.getElementById('mobile-create-shopping');
const newWorkspaceBtn = document.getElementById('new-workspace-btn');
const moduleNavTodo = document.getElementById('module-nav-todo');
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
const modalAssignee = document.getElementById('modal-assignee');
const modalAssigneeLabelRow = document.getElementById('modal-assignee-label-row');
const modalAssigneeLabel = document.getElementById('modal-assignee-label');
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
const settingsOpen = document.getElementById('settings-open');
const profileOpen = document.getElementById('profile-open');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsOpenDataTransfer = document.getElementById('settings-open-data-transfer');
const settingsOpenAuditLog = document.getElementById('settings-open-audit-log');
const settingsOpenAutomation = document.getElementById('settings-open-automation');
const dataTransferBack = document.getElementById('data-transfer-back');
const auditLogBack = document.getElementById('audit-log-back');
const automationBack = document.getElementById('automation-back');
const adminPageBack = document.getElementById('admin-page-back');
const adminInviteEmail = document.getElementById('admin-invite-email');
const adminInviteWorkspace = document.getElementById('admin-invite-workspace');
const adminInviteRole = document.getElementById('admin-invite-role');
const adminInviteSend = document.getElementById('admin-invite-send');
const adminInviteStatus = document.getElementById('admin-invite-status');
const adminInvitesRefresh = document.getElementById('admin-invites-refresh');
const adminInvitesList = document.getElementById('admin-invites-list');
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
const taskEditor = document.getElementById('task-editor');
const taskEditorBody = document.getElementById('task-editor-body');
const taskEditorScrollbar = document.getElementById('task-editor-scrollbar');
const taskEditorScrollThumb = document.getElementById('task-editor-scroll-thumb');
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
let openMenu = null;
let authModalMode = 'login';
let renameGroupLabel = null;
let editingTemplateId = null;
let editingWorkflowId = null;
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

const SYNC_POLL_INTERVAL_MS = 5000;
const SYNC_BACKOFF_STEPS_MS = [30000, 60000, 120000, 300000];
const AUDIT_LOG_MAX_ENTRIES = 2000;
const AUDIT_LOG_ALLOWED_CATEGORIES = new Set(['crud', 'notification', 'export', 'import', 'error']);
const OWNER_SUPER_ADMIN_EMAIL = 'brian@pipecaminc.com';
const NAVIGABLE_VIEWS = new Set([
  'tasks',
  'projects',
  'shopping',
  'notices',
  'workflows',
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

taskToolsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== taskToolsMenu) {
    openMenu.classList.add('hidden');
  }
  if (taskToolsMenu.classList.contains('hidden')) {
    taskToolsMenu.classList.remove('hidden');
    openMenu = taskToolsMenu;
  } else {
    taskToolsMenu.classList.add('hidden');
    openMenu = null;
  }
});

taskToolsMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

taskToolsToggleQuickAdd?.addEventListener('click', () => {
  setTaskQuickAddVisible(!getTaskQuickAddVisible());
  taskToolsMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

taskToolsMobileFilter?.addEventListener('click', () => {
  cycleTaskFilterSelection();
  taskToolsMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

taskToolsMobileSort?.addEventListener('click', async () => {
  const sortKey = cycleTaskSortSelection();
  taskToolsMenu?.classList.add('hidden');
  openMenu = null;
  if (sortKey === 'ai-queue') {
    const hasTaskSuggestions = getAiSuggestions().some(item => item?.task_id);
    if (!hasTaskSuggestions) {
      await refreshAiSuggestions(getFilteredTasks());
      return;
    }
  }
  render();
});

taskToolsMobileGroup?.addEventListener('click', () => {
  cycleTaskGroupSelection();
  taskToolsMenu?.classList.add('hidden');
  openMenu = null;
  render();
});

taskToolsMobileView?.addEventListener('click', () => {
  cycleTaskViewSelection();
  taskToolsMenu?.classList.add('hidden');
  openMenu = null;
  render();
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

taskSortMenu?.addEventListener('click', async (event) => {
  event.stopPropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const sortKey = target.dataset.sort;
  if (!sortKey) return;
  if (sortKey === 'ai-queue' && isWorkflowChecklistViewActive()) {
    setTaskSortKey('default');
    taskSortMenu.classList.add('hidden');
    openMenu = null;
    render();
    return;
  }
  setTaskSortKey(sortKey);
  taskSortMenu.classList.add('hidden');
  openMenu = null;
  if (sortKey === 'ai-queue') {
    const hasTaskSuggestions = getAiSuggestions().some(item => item?.task_id);
    if (!hasTaskSuggestions) {
      await refreshAiSuggestions(getFilteredTasks());
      return;
    }
  }
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
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});
moduleNavTodo?.addEventListener('click', () => {
  clearActiveWorkflowChecklistInstanceId();
  setActiveView('tasks');
  render();
});

mobileNavButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (!view) return;
    if (view === 'workflows') {
      setWorkflowViewMode('runs');
      setMobileWorkflowPanelMode('list');
    }
    if (view === 'shopping') {
      setMobileShoppingPanelMode('list');
    }
    setActiveView(view);
    render();
  });
});

mobileNavAdd?.addEventListener('click', () => {
  handleMobileQuickAdd();
});

mobileTopMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!mobileTopMenu) return;
  if (openMenu && openMenu !== mobileTopMenu) {
    openMenu.classList.add('hidden');
  }
  if (mobileTopMenu.classList.contains('hidden')) {
    mobileTopMenu.classList.remove('hidden');
    openMenu = mobileTopMenu;
  } else {
    mobileTopMenu.classList.add('hidden');
    openMenu = null;
  }
});

mobileTopMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
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

mobileCreateTask?.addEventListener('click', () => {
  closeMobileCreateSheet();
  runMobileCreateAction('task');
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
  const repeatPreset = noticeRepeatPreset?.value ?? 'none';
  const recurrenceRule = buildNoticeRecurrenceRuleFromPreset(repeatPreset, notifyAt);
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
  pushRows('task_section', payload.taskSections, item => ({ name: item.label }));
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

  return {
    workspace,
    projects: cloneArrayOfObjects(raw.projects),
    statuses: cloneArrayOfObjects(raw.statuses),
    taskTypes: cloneArrayOfObjects(raw.taskTypes),
    taskSections: cloneArrayOfObjects(raw.taskSections),
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
    ...payload.taskSections
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
      status: command.status ?? getDefaultStatusKey(),
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
    '  Allowed views: tasks, projects, shopping, notices, workflows, data-transfer, audit-log, automation, workspaces-manage, workspaces-archived',
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

function openMobileCreateSheet() {
  if (!isMobileViewport() || !mobileCreateSheet) {
    runMobileCreateAction('task');
    return;
  }
  closeMobileTopMenu();
  mobileCreateSheet.classList.remove('hidden');
  document.body.classList.add('mobile-create-open');
}

function closeMobileCreateSheet() {
  if (mobileCreateSheet) {
    mobileCreateSheet.classList.add('hidden');
  }
  document.body.classList.remove('mobile-create-open');
}

function closeMobileTopMenu() {
  if (!mobileTopMenu) return;
  mobileTopMenu.classList.add('hidden');
  if (openMenu === mobileTopMenu) {
    openMenu = null;
  }
}

function getViewLabel(view) {
  switch (view) {
    case 'projects':
      return 'Projects';
    case 'shopping':
      return 'Shopping Lists';
    case 'notices':
      return 'Notices';
    case 'workflows':
      return 'Workflows';
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

function renderMobileNavigation() {
  if (!mobileNav) return;
  const activeView = getActiveView();
  mobileNavButtons.forEach((button) => {
    const isActive = button.dataset.view === activeView;
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

function runMobileCreateAction(action) {
  if (action === 'task') {
    setActiveView('tasks');
    render();
    openTaskModal();
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
    closeMobileCreateSheet();
  }
}

function getTaskView() {
  return state.ui?.taskView ?? 'list';
}

function setTaskView(view) {
  state.ui = state.ui ?? {};
  state.ui.taskView = view;
}

function isWorkflowChecklistViewActive() {
  return Boolean(getActiveWorkflowChecklistInstanceId());
}

function getTaskSortKey() {
  const key = state.ui?.taskSort ?? 'default';
  if (isWorkflowChecklistViewActive() && key === 'ai-queue') {
    return 'default';
  }
  return key;
}

function setTaskSortKey(key) {
  state.ui = state.ui ?? {};
  state.ui.taskSort = key;
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

function getSectionsForWorkspace() {
  if (!state.workspace) return [];
  const workspaceId = state.workspace.id;
  const sections = (state.taskSections ?? [])
    .filter(section => section.workspace_id === workspaceId);
  const byLabel = new Map(sections.map(section => [section.label, section]));
  Object.values(state.tasks ?? {})
    .filter(task => task.workspace_id === workspaceId)
    .forEach(task => {
      const label = (task.group_label ?? '').trim();
      if (!label || byLabel.has(label)) return;
      byLabel.set(label, {
        id: `derived-${label}`,
        workspace_id: workspaceId,
        label,
        sort_order: null
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

function createSectionRecord(label) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(label);
  if (!trimmed) return null;
  const workspaceId = state.workspace.id;
  const existing = getSectionsForWorkspace().find(section => section.label === trimmed);
  if (existing && existing.workspace_id === workspaceId && isPersistedSection(existing)) return existing;
  const now = new Date().toISOString();
  const maxSort = Math.max(0, ...((state.taskSections ?? [])
    .filter(section => section.workspace_id === workspaceId)
    .map(section => section.sort_order ?? 0)));
  const section = {
    id: createId(),
    workspace_id: workspaceId,
    label: trimmed,
    sort_order: maxSort + 10,
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
      assignee_label: assigneeLabel ?? null
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

async function deleteTaskSection(label) {
  if (!state.workspace) return;
  const workspaceId = state.workspace.id;
  const trimmed = String(label ?? '').trim();
  if (!trimmed) return;
  const sections = state.taskSections ?? [];
  const updatedSections = sections.filter(section =>
    !(section.workspace_id === workspaceId && section.label === trimmed)
  );
  if (updatedSections.length !== sections.length) {
    state.taskSections = updatedSections;
    persistLocalData();
  }
  const tasks = Object.values(state.tasks ?? {});
  for (const task of tasks) {
    if (task.workspace_id !== workspaceId) continue;
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
    if (syncStatus) syncStatus.textContent = 'Syncing...';
    if (!navigator.onLine) {
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
          render();
        }
      }
    }
    if (syncStatus) {
      syncStatus.textContent = `Online · synced ${formatSyncTime(syncLastSuccessAt)} · errors ${syncErrorCount}`;
    }
  } catch {
    registerSyncFailure();
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
  saveLocalData({
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
  payload.status = payload.status ?? localTask?.status ?? getDefaultStatusKey();
  payload.priority = payload.priority ?? localTask?.priority ?? 'medium';

  // Keep local and pending copies aligned so replay does not repeatedly fail.
  if (change) {
    change.payload = payload;
  }
  if (localTask) {
    localTask.title = payload.title;
    localTask.workspace_id = payload.workspace_id;
    localTask.status = payload.status;
    localTask.priority = payload.priority;
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
  state.taskSections = data.taskSections ?? [];
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
            status: getDefaultStatusKey(),
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
  ensureLocalWorkspaceDefaults(state.workspace);
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const preferredListId = state.ui?.activeShoppingListId;
  const availableLists = state.shoppingLists.filter(list =>
    shouldShowShoppingListInSidebar(list, { showArchived })
  );
  const activeList = availableLists.find(list => list.id === preferredListId)
    ?? availableLists.find(list => !list.archived && !isShoppingListComplete(list.id))
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

function normalizeUser(user) {
  return {
    ...user,
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

function normalizeTask(task) {
  return {
    ...task,
    auto_debit: Number(task.auto_debit) ? 1 : 0,
    template_prompt_pending: Number(task.template_prompt_pending) ? 1 : 0,
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
  const statusKey = parentId ? null : (payload.status ?? getDefaultStatusKey());
  const sortOrder = payload.sort_order === undefined || payload.sort_order === null
    ? getNextTaskSortOrder(parentId, statusKey)
    : payload.sort_order;
  const normalizedTitle = normalizeTitleInput(payload.title);
  const normalizedType = payload.type_label ? normalizeTitleInput(payload.type_label) : payload.type_label;
  const normalizedGroup = payload.group_label ? normalizeTitleInput(payload.group_label) : payload.group_label;
  const normalizedAssigneeLabel = payload.assignee_label ? normalizeTitleInput(payload.assignee_label) : null;
  const taskPayload = {
    ...payload,
    title: normalizedTitle || 'Untitled task',
    type_label: normalizedType ?? null,
    group_label: normalizedGroup ?? null,
    assignee_user_id: payload.assignee_user_id ?? null,
    assignee_label: normalizedAssigneeLabel,
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
  const status = taskPayload.status ?? getDefaultStatusKey();
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

async function createProjectRecord(name) {
  if (!state.workspace) return null;
  const trimmed = normalizeTitleInput(name);
  if (!trimmed) return null;
  const canUseRemote = navigator.onLine && !hasPendingLocalChanges();
  if (canUseRemote) {
    try {
      const created = await api.createProject({ name: trimmed, workspace_id: state.workspace.id, kind: 'project' });
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
    kind: 'project',
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
  const nextStatus = editorStatus?.value ?? task.status ?? getDefaultStatusKey();
  const nextParentId = editorParent?.value || null;
  const description = getNotesContent();
  const typeLabel = editorType?.value ? editorType.value.trim() : null;
  const recurrence = editorRecurrence ?? { interval: null, unit: null };
  const reminderValue = parseInt(editorReminder?.value ?? '', 10);
  const reminder = Number.isFinite(reminderValue) ? reminderValue : null;
  const startAt = editorStart ? fromDatetimeLocal(editorStart.value) : null;
  const dueAt = fromDatetimeLocal(editorDue?.value ?? '');
  const projectId = editorProject?.value || null;
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
  if (priority !== (task.priority ?? 'medium')) patch.priority = priority;
  if ((projectId ?? null) !== (task.project_id ?? null)) patch.project_id = projectId;
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
  if (nextStatus !== (task.status ?? getDefaultStatusKey())) patch.status = nextStatus;

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

  if (patch.status) {
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
  if (!taskBulkBar || !taskBulkCount) return;
  const selected = getSelectedTaskIds();
  const hasHistory = getBulkUndoStack().length > 0;
  if (!selected.length && !hasHistory) {
    taskBulkBar.classList.add('hidden');
    return;
  }
  taskBulkCount.textContent = selected.length ? `${selected.length} selected` : 'No selection';
  taskBulkBar.classList.remove('hidden');
  if (taskBulkEditBtn) taskBulkEditBtn.disabled = !selected.length;
  if (taskBulkDeleteBtn) taskBulkDeleteBtn.disabled = !selected.length;
  if (taskBulkClearBtn) taskBulkClearBtn.disabled = !selected.length;
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

function attachQuickAddClick(addInput, createFn) {
  addInput.addEventListener('mousedown', async (event) => {
    if (event.button !== 0) return;
    if (addInput.value.trim()) return;
    event.preventDefault();
    const created = await createFn();
    if (created?.id) {
      requestInlineTaskEdit(created.id);
      render();
    }
  });
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
  const sections = (state.taskSections ?? [])
    .filter(section => section.workspace_id === workspaceId);
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

function getTaskSortComparator(tasks = null) {
  const key = getTaskSortKey();
  if (key === 'due-asc') {
    return (a, b) => compareTasksByDueDate(a, b, 'asc');
  }
  if (key === 'due-desc') {
    return (a, b) => compareTasksByDueDate(a, b, 'desc');
  }
  if (key === 'ai-queue') {
    const rankMap = buildAiQueueRankMap(tasks ?? getFilteredTasks());
    return (a, b) => compareTasksByAiQueue(a, b, rankMap);
  }
  return compareTasksByPriority;
}

function renderAiQueueBanner(tasks) {
  if (isWorkflowChecklistViewActive()) return;
  if (getTaskSortKey() !== 'ai-queue') return;
  const banner = document.createElement('section');
  banner.className = 'ai-queue-banner';

  const title = document.createElement('div');
  title.className = 'ai-queue-title';
  title.textContent = 'AI Queue';
  banner.appendChild(title);

  const suggestionCount = getAiSuggestions().filter(item => item?.task_id && item.decision !== 'rejected').length;
  const rankCount = buildAiQueueRankMap(tasks).size;
  const summary = document.createElement('div');
  summary.className = 'ai-queue-summary';
  summary.textContent = suggestionCount
    ? `Ordered by AI suggestions. ${rankCount} task${rankCount === 1 ? '' : 's'} in queue.`
    : 'No explicit AI picks yet. Using AI queue fallback ordering.';
  banner.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'ai-queue-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'subtle-button';
  refreshBtn.textContent = state.ui?.aiSuggestionLoading ? 'Refreshing…' : 'Refresh queue';
  refreshBtn.disabled = Boolean(state.ui?.aiSuggestionLoading);
  refreshBtn.addEventListener('click', async () => {
    await refreshAiSuggestions(tasks);
  });
  actions.appendChild(refreshBtn);

  const showBtn = document.createElement('button');
  showBtn.type = 'button';
  showBtn.className = 'subtle-button';
  showBtn.textContent = 'Open suggestions';
  showBtn.addEventListener('click', () => {
    if (!taskAiMenu) return;
    if (openMenu && openMenu !== taskAiMenu) {
      openMenu.classList.add('hidden');
    }
    renderAiSuggestionsMenu(tasks);
    taskAiMenu.classList.remove('hidden');
    openMenu = taskAiMenu;
  });
  actions.appendChild(showBtn);

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
  const currentSelected = getSelectedTaskIds();
  const validSelected = currentSelected.filter(id => state.tasks?.[id]);
  if (validSelected.length !== currentSelected.length) {
    state.ui = state.ui ?? {};
    state.ui.selectedTaskIds = validSelected;
  }
  renderWorkspaceList();
  renderAccountMenu();
  renderProfilePage();
  renderProjectList();
  renderProjectsPage();
  renderWorkflowList();
  renderTemplateList();
  renderTeamMemberList();
  renderTaskTypeList();
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
  if (view === 'kanban') {
    sortTree(tree, compareTasksByPriority);
    renderKanban(tree);
  } else if (view === 'calendar') {
    renderCalendarView(tasks);
  } else {
    sortTree(tree, getTaskSortComparator(tasks));
    renderAiQueueBanner(tasks);
    renderTaskList(tree);
  }
  if (taskAiMenu && !taskAiMenu.classList.contains('hidden')) {
    renderAiSuggestionsMenu(tasks);
  }
  renderShoppingPanel();
  renderView();
  renderMobileNavigation();
  if (taskColumnsModal && !taskColumnsModal.classList.contains('hidden')) {
    renderTaskColumnsModal();
  }
  if (noticeModal && !noticeModal.classList.contains('hidden')) {
    renderNoticeTypeSelect(noticeType?.value ?? '');
  }
  renderNotificationStatus();
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
  const showProjects = view === 'projects';
  const showShopping = view === 'shopping';
  const showNotices = view === 'notices';
  const showWorkflows = view === 'workflows';
  const showAdmin = view === 'admin';
  const showProfile = view === 'profile';
  const showDataTransfer = view === 'data-transfer';
  const showAuditLog = view === 'audit-log';
  const showAutomation = view === 'automation';
  const showManageWorkspaces = view === 'workspaces-manage';
  const showArchivedWorkspaces = view === 'workspaces-archived';

  tasksPanel?.classList.toggle('hidden', !showTasks);
  projectsPage?.classList.toggle('hidden', !showProjects);
  shoppingPage?.classList.toggle('hidden', !showShopping);
  noticesPage?.classList.toggle('hidden', !showNotices);
  workflowsPage?.classList.toggle('hidden', !showWorkflows);
  adminPage?.classList.toggle('hidden', !showAdmin);
  profilePage?.classList.toggle('hidden', !showProfile);
  dataTransferPage?.classList.toggle('hidden', !showDataTransfer);
  auditLogPage?.classList.toggle('hidden', !showAuditLog);
  automationPage?.classList.toggle('hidden', !showAutomation);
  workspaceManagePage?.classList.toggle('hidden', !showManageWorkspaces);
  workspaceArchivedPage?.classList.toggle('hidden', !showArchivedWorkspaces);
}

function getProjectsForWorkspace() {
  if (!state.workspace) return [];
  return (state.projects ?? []).filter(project => project.workspace_id === state.workspace.id && !project.archived);
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
  if (explicitActive) return explicitActive;
  const showArchived = Boolean(state.ui?.showArchivedShoppingLists);
  const visibleLists = allLists.filter(list => shouldShowShoppingListInSidebar(list, { showArchived }));
  return visibleLists.find(list => !list.archived && !isShoppingListComplete(list.id))
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
  const items = getShoppingItemsForList(listId);
  if (!items.length) return false;
  return items.every(item => item.is_checked);
}

function isShoppingListClosed(list) {
  if (!list) return false;
  return Boolean(list.archived) || isShoppingListComplete(list.id);
}

function shouldShowShoppingListInSidebar(list, { showArchived = false } = {}) {
  if (!list) return false;
  if (showArchived) return true;
  if (list.archived) return false;
  return !isShoppingListComplete(list.id);
}

function getActiveTaskFilter() {
  return state.ui?.activeProjectId ?? null;
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

function getTaskSearchText() {
  return String(state.ui?.taskSearchText ?? '').trim();
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

function getTaskSearchResultKey(workspaceId, text, status) {
  return `${workspaceId ?? ''}|${String(text ?? '').trim().toLowerCase()}|${status ?? ''}`;
}

function clearTaskSearchResult() {
  taskSearchResultIds = null;
  taskSearchResultKey = '';
  taskSearchInFlightKey = '';
}

async function refreshTaskSearchResults() {
  const workspaceId = state.workspace?.id ?? null;
  const text = getTaskSearchText();
  const status = getTaskSearchStatusFilter();
  const queryKey = getTaskSearchResultKey(workspaceId, text, status);
  if (!workspaceId || !text) {
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
      status
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
  const nonWorkflowTasks = tasks.filter(task => !getChecklistLinkForTask(task.id, null));
  const filter = getActiveTaskFilter();
  let filtered = nonWorkflowTasks;
  if (filter === TASK_FILTER_UNASSIGNED) {
    filtered = filtered.filter(task => !task.project_id);
  } else if (filter === TASK_FILTER_INBOX) {
    filtered = filtered.filter(task => isInboxStatusKey(task.status ?? getDefaultStatusKey()));
  } else if (filter) {
    filtered = filtered.filter(task => task.project_id === filter);
  }

  const query = getTaskSearchText();
  if (!query) return filtered;
  const queryKey = getTaskSearchResultKey(state.workspace.id, query, getTaskSearchStatusFilter());
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
  let label = 'All tasks';
  if (active === TASK_FILTER_UNASSIGNED) {
    return 'Unassigned';
  } else if (active === TASK_FILTER_INBOX) {
    return 'Inbox';
  } else if (active) {
    const project = (state.projects ?? []).find(item => item.id === active);
    label = project?.name ?? 'All tasks';
  }
  return label;
}

function cycleTaskFilterSelection() {
  const projectIds = getProjectsForWorkspace().map(project => project.id);
  const cycle = [null, TASK_FILTER_INBOX, TASK_FILTER_UNASSIGNED, ...projectIds];
  const active = getActiveTaskFilter();
  const activeKey = active === undefined ? null : active;
  const currentIndex = cycle.findIndex(item => item === activeKey);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cycle.length : 0;
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = cycle[nextIndex] ?? null;
  clearActiveWorkflowChecklistInstanceId();
  scheduleTaskSearchRefresh(true);
}

function cycleTaskSortSelection() {
  const cycle = isWorkflowChecklistViewActive()
    ? ['default', 'due-asc', 'due-desc']
    : ['default', 'due-asc', 'due-desc', 'ai-queue'];
  const current = getTaskSortKey();
  const currentIndex = cycle.indexOf(current);
  const next = cycle[(currentIndex + 1) % cycle.length] ?? 'default';
  setTaskSortKey(next);
  return next;
}

function cycleTaskGroupSelection() {
  const cycle = ['none', 'section', 'task-type', 'priority'];
  const current = getTaskGroupMode();
  const currentIndex = cycle.indexOf(current);
  const next = cycle[(currentIndex + 1) % cycle.length] ?? 'none';
  setTaskGroupMode(next);
}

function cycleTaskViewSelection() {
  const cycle = ['list', 'kanban', 'calendar'];
  const current = getTaskView();
  const currentIndex = cycle.indexOf(current);
  const next = cycle[(currentIndex + 1) % cycle.length] ?? 'list';
  setTaskView(next);
}

function renderTaskTools() {
  if (!taskToolsToggleQuickAdd) return;
  const mobile = isMobileViewport();
  const checklistViewActive = isWorkflowChecklistViewActive();
  const taskToolsWrapper = taskToolsButton?.closest('.task-tools');
  taskToolsWrapper?.classList.toggle('hidden', checklistViewActive);
  if (checklistViewActive) {
    taskToolsMenu?.classList.add('hidden');
    if (openMenu === taskToolsMenu) {
      openMenu = null;
    }
  }
  taskToolsToggleQuickAdd.classList.toggle('hidden', mobile);
  taskToolsToggleQuickAdd.textContent = `${getTaskQuickAddVisible() ? 'Hide' : 'Show'} quick add`;
  taskToolsMobileFilter?.classList.toggle('hidden', !mobile || checklistViewActive);
  taskToolsMobileSort?.classList.toggle('hidden', !mobile);
  taskToolsMobileGroup?.classList.toggle('hidden', !mobile);
  taskToolsMobileView?.classList.toggle('hidden', !mobile);
  if (taskToolsMobileFilter) {
    taskToolsMobileFilter.textContent = `Filter: ${getTaskFilterLabel()}`;
  }
  if (taskToolsMobileSort) {
    const sortLabelMap = {
      default: 'Default',
      'due-asc': 'Due (Soonest)',
      'due-desc': 'Due (Latest)',
      'ai-queue': 'AI queue'
    };
    taskToolsMobileSort.textContent = `Sort: ${sortLabelMap[getTaskSortKey()] ?? 'Default'}`;
  }
  if (taskToolsMobileGroup) {
    const groupLabelMap = {
      none: 'None',
      section: 'Section',
      'task-type': 'Task type',
      priority: 'Priority'
    };
    taskToolsMobileGroup.textContent = `Group: ${groupLabelMap[getTaskGroupMode()] ?? 'None'}`;
  }
  if (taskToolsMobileView) {
    const viewLabelMap = {
      list: 'List',
      kanban: 'Kanban',
      calendar: 'Calendar'
    };
    taskToolsMobileView.textContent = `View: ${viewLabelMap[getTaskView()] ?? 'List'}`;
  }
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

function renderTaskSort() {
  if (!taskSortButton || !taskSortMenu) return;
  const checklistViewActive = isWorkflowChecklistViewActive();
  const aiSortItem = taskSortMenu.querySelector('[data-sort="ai-queue"]');
  if (aiSortItem instanceof HTMLElement) {
    aiSortItem.classList.toggle('hidden', checklistViewActive);
  }
  const key = getTaskSortKey();
  const labelMap = {
    default: 'Sort',
    'due-asc': 'Due date (soonest)',
    'due-desc': 'Due date (latest)',
    'ai-queue': 'AI queue'
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

function getAuthState() {
  state.ui = state.ui ?? {};
  if (!state.ui.auth || typeof state.ui.auth !== 'object') {
    state.ui.auth = {
      authenticated: false,
      requireAuth: false,
      user: null,
      session: null,
      workspaces: []
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
  if (authLoginForm) authLoginForm.classList.toggle('hidden', authModalMode !== 'login');
  if (authInviteForm) authInviteForm.classList.toggle('hidden', authModalMode !== 'invite');
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
  authModal?.classList.add('hidden');
  setAuthStatus('');
}

function applyAuthPayload(payload, { persistProfile = true } = {}) {
  const auth = getAuthState();
  const user = payload?.user && typeof payload.user === 'object' ? payload.user : null;
  const session = payload?.session && typeof payload.session === 'object' ? payload.session : null;
  const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'require_auth')) {
    auth.requireAuth = Boolean(payload.require_auth);
  }
  auth.authenticated = Boolean(payload?.authenticated && user?.id);
  auth.user = auth.authenticated ? {
    id: user.id,
    org_id: user.org_id,
    display_name: user.display_name,
    email: user.email
  } : null;
  auth.session = auth.authenticated ? {
    id: session?.id ?? null,
    expires_at: session?.expires_at ?? null
  } : null;
  auth.workspaces = workspaces;
  if (persistProfile) {
    state.ui.profile = auth.user
      ? { name: auth.user.display_name, email: auth.user.email }
      : { name: '', email: '' };
  }
}

function clearWorkspaceDomainData() {
  state.workspace = null;
  state.workspaces = [];
  state.projects = [];
  state.templates = [];
  state.workflows = [];
  state.workflowVariants = [];
  state.workflowPhases = [];
  state.workflowVariantPhases = [];
  state.workflowPhaseTasks = [];
  state.workflowPatterns = [];
  state.workflowPatternTasks = [];
  state.workflowInstances = [];
  state.workflowInstanceTasks = [];
  state.statuses = [];
  state.taskTypes = [];
  state.users = [];
  state.workspaceMemberships = [];
  state.taskSections = [];
  state.storeRules = [];
  state.tasks = {};
  state.taskDependencies = [];
  state.notices = [];
  state.noticeTypes = [];
  state.shoppingLists = [];
  state.shoppingItems = {};
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
  } catch {
    applyAuthPayload({ authenticated: false }, { persistProfile: false });
  }
}

async function reloadWorkspaceAfterAuthChange() {
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
    authLoginPassword.value = '';
    closeAuthModal();
    await reloadWorkspaceAfterAuthChange();
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
    authInvitePassword.value = '';
    clearInviteTokenFromUrl();
    closeAuthModal();
    await reloadWorkspaceAfterAuthChange();
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

function isOwnerSuperAdminEmail(email) {
  return normalizeActorEmail(email) === OWNER_SUPER_ADMIN_EMAIL;
}

function isCurrentActorOwnerSuperAdmin() {
  return isOwnerSuperAdminEmail(getProfileEmail());
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
    accountAdmin.classList.toggle('hidden', !isCurrentActorOwnerSuperAdmin());
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

function saveProfilePage() {
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
  state.ui = state.ui ?? {};
  state.ui.profile = {
    name,
    email
  };
  appendCrudEvent({
    source: 'profile',
    event: 'updated',
    entity_type: 'profile',
    entity_id: 'self',
    data: { name, email }
  });
  render();
}

function populateAdminInviteWorkspaceSelect() {
  if (!adminInviteWorkspace) return;
  const activeWorkspaceId = state.workspace?.id ?? '';
  const workspaces = (state.workspaces ?? []).filter(item => !item.archived);
  const previous = adminInviteWorkspace.value || activeWorkspaceId;
  adminInviteWorkspace.innerHTML = '';
  workspaces.forEach((workspace) => {
    const option = document.createElement('option');
    option.value = workspace.id;
    option.textContent = workspace.name;
    adminInviteWorkspace.appendChild(option);
  });
  if (workspaces.some(item => item.id === previous)) {
    adminInviteWorkspace.value = previous;
  } else if (activeWorkspaceId && workspaces.some(item => item.id === activeWorkspaceId)) {
    adminInviteWorkspace.value = activeWorkspaceId;
  }
}

function getAdminInvitesState() {
  state.ui = state.ui ?? {};
  if (!state.ui.admin) {
    state.ui.admin = {
      invites: [],
      loading: false,
      error: ''
    };
  }
  return state.ui.admin;
}

function renderAdminInvitesList() {
  if (!adminInvitesList) return;
  const adminState = getAdminInvitesState();
  adminInvitesList.innerHTML = '';
  if (adminState.loading) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = 'Loading invites...';
    adminInvitesList.appendChild(note);
    return;
  }
  if (adminState.error) {
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = adminState.error;
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
    meta.textContent = `${invite.role} • expires ${formatDateTime(invite.expires_at)}${workspaceName}`;
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(info);
    adminInvitesList.appendChild(row);
  });
}

function renderAdminPage() {
  if (!adminPage) return;
  if (adminInviteRole && !adminInviteRole.value) {
    adminInviteRole.value = 'member';
  }
  if (adminInviteStatus && !adminInviteStatus.dataset.pinned) {
    adminInviteStatus.textContent = isCurrentActorOwnerSuperAdmin()
      ? `Owner: ${OWNER_SUPER_ADMIN_EMAIL}`
      : 'Owner access required.';
  }
  populateAdminInviteWorkspaceSelect();
  renderAdminInvitesList();
}

async function refreshAdminInvites() {
  const adminState = getAdminInvitesState();
  const workspaceId = adminInviteWorkspace?.value || state.workspace?.id || null;
  if (!workspaceId) {
    adminState.invites = [];
    adminState.error = 'Select a workspace first.';
    adminState.loading = false;
    renderAdminInvitesList();
    return;
  }
  adminState.loading = true;
  adminState.error = '';
  renderAdminInvitesList();
  try {
    const response = await api.listAdminInvites({ workspaceId, status: 'pending' });
    adminState.invites = response?.invites ?? [];
  } catch (err) {
    adminState.error = err?.message ?? 'Unable to load invites.';
  } finally {
    adminState.loading = false;
    renderAdminInvitesList();
  }
}

function setAdminInviteStatus(message, type = 'info') {
  if (!adminInviteStatus) return;
  adminInviteStatus.textContent = message;
  adminInviteStatus.dataset.pinned = type === 'info' ? '' : '1';
}

async function submitAdminInvite() {
  if (!adminInviteEmail || !adminInviteWorkspace) return;
  const email = normalizeActorEmail(adminInviteEmail.value);
  if (!email) {
    setAdminInviteStatus('Enter a valid email address.', 'error');
    adminInviteEmail.focus();
    return;
  }
  const workspaceId = adminInviteWorkspace.value;
  if (!workspaceId) {
    setAdminInviteStatus('Select a workspace.', 'error');
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
      const base = window.location.origin.replace(/\/$/, '');
      const inviteUrl = `${base}/apps/web/?invite_token=${encodeURIComponent(inviteToken)}`;
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setAdminInviteStatus(`Invite created for ${response?.invite?.email ?? email}. Link copied to clipboard.`);
      } catch {
        setAdminInviteStatus(`Invite created for ${response?.invite?.email ?? email}. Link: ${inviteUrl}`);
      }
    } else {
      setAdminInviteStatus(`Invite sent to ${response?.invite?.email ?? email}.`);
    }
    adminInviteEmail.value = '';
    await refreshAdminInvites();
  } catch (err) {
    setAdminInviteStatus(err?.message ?? 'Unable to send invite.', 'error');
  } finally {
    adminInviteSend?.removeAttribute('disabled');
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
      state.ui = state.ui ?? {};
      state.ui.activeProjectId = project.id;
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
  let projects = (state.projects ?? [])
    .filter(project => project.workspace_id === state.workspace.id);
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
        state.ui = state.ui ?? {};
        state.ui.activeProjectId = project.id;
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
    const empty = document.createElement('div');
    empty.className = 'sidebar-note';
    empty.textContent = 'Select a workflow to view runs.';
    workflowDetailEl.appendChild(empty);
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
    selectBtn.textContent = list.archived ? `${list.name} (completed)` : list.name;
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
      name.textContent = list.name;
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
  shoppingListTitle.textContent = activeList.name;
  const items = getShoppingItemsForList(activeList.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const complete = isShoppingListComplete(activeList.id);
  shoppingListSubtitle.textContent = `${items.length} items${complete ? ' · complete' : ''}${activeList.archived ? ' · completed' : ''}`;
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
  const inlineAddDisabled = isMobileViewport();
  const quickAddVisible = getTaskQuickAddVisible();
  const checklistInstanceId = getActiveWorkflowChecklistInstanceId();
  const groupMode = checklistInstanceId
    ? 'workflow-phase'
    : (getTaskSortKey() === 'ai-queue' ? 'none' : getTaskGroupMode());
  if (groupMode === 'none') {
    const topDropzone = document.createElement('div');
    topDropzone.className = 'task-root-dropzone';
    attachTaskDropzone(topDropzone, { parentId: null });
    taskTreeEl.appendChild(topDropzone);
  }

  const list = document.createElement('div');
  list.className = 'task-list';
  if (groupMode === 'none') {
    attachTaskDropzone(list, { parentId: null });
  }
  let defaultGroupList = null;
  if (groupMode === 'section') {
    const sections = getSectionsForWorkspace();
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
      attachQuickAddClick(addInput, () => createTaskRecord({ title: '', group_label: sectionLabel }));
      addInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const title = addInput.value.trim();
          if (!title) return;
          await createTaskRecord({ title, group_label: sectionLabel });
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
        showTaskGroupContextMenu(label, event.clientX, event.clientY);
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
      (grouped.get(label) ?? []).forEach(node => groupList.appendChild(renderTask(node)));
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
      ungrouped.forEach(node => ungroupedList.appendChild(renderTask(node)));
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
      attachQuickAddClick(addInput, () => createTaskRecord({ title: '' }));
      addInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const title = addInput.value.trim();
          if (!title) return;
          await createTaskRecord({ title });
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
      group.tasks.forEach(node => groupList.appendChild(renderTask(node)));
      section.appendChild(groupList);
      list.appendChild(section);
    });

    if (ungrouped.length) {
      const ungroupedList = document.createElement('div');
      ungroupedList.className = 'task-group-list task-ungrouped-list';
      attachTaskDropzone(ungroupedList, { parentId: null });
      ungrouped.forEach(node => ungroupedList.appendChild(renderTask(node)));
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
      group.tasks.forEach(node => groupList.appendChild(renderTask(node)));
      section.appendChild(groupList);
      list.appendChild(section);
      if (group.key === '__none__' || groupMode === 'priority' && group.value === 'medium') {
        defaultGroupList = groupList;
      }
    });
  } else {
    roots.forEach(node => list.appendChild(renderTask(node)));
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
    attachQuickAddClick(addInput, () => createTaskRecord({ title: '' }));
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
  const inlineAddDisabled = isMobileViewport();
  const quickAddVisible = getTaskQuickAddVisible();
  if ((inlineAddDisabled || !quickAddVisible) && state.ui?.kanbanQuickAdd) {
    setKanbanQuickAdd(null);
  }
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
  const taskActions = node.querySelector('.task-actions');
  const taskMenuWrapper = node.querySelector('.task-menu-wrapper');
  const childrenEl = node.querySelector('.task-children');
  const hasChildren = task.children && task.children.length > 0;
  const collapsedMap = state.ui?.collapsedTasks ?? {};
  const isCollapsed = Boolean(collapsedMap[task.id]);
  const statusKey = task.status ?? getDefaultStatusKey();
  const checklistViewActive = isWorkflowChecklistViewActive();
  const checklistInstanceId = checklistViewActive ? getActiveWorkflowChecklistInstanceId() : null;
  const workflowLink = checklistViewActive ? getChecklistLinkForTask(task.id, checklistInstanceId) : null;
  const isChecklistIa = Boolean(workflowLink?.if_applicable);
  const isChecklistDismissed = Boolean(workflowLink?.dismissed_at);
  const isChecklistRowDisabled = checklistViewActive && isChecklistDismissed;

  titleEl.textContent = task.title;
  titleEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (suppressTaskClick) return;
    if (isChecklistRowDisabled) return;
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

  if (state.ui?.inlineEditTaskId === task.id) {
    state.ui.inlineEditTaskId = null;
    beginInlineTaskEdit(task, item, titleEl, { selectAll: true });
  }

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
      status: task.status ?? getDefaultStatusKey(),
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

function openSettings() {
  settingsModal?.classList.remove('hidden');
  renderAuditLogOutput();
}

function closeSettings() {
  settingsModal?.classList.add('hidden');
}

function openSettingsLinkedPage(view) {
  state.ui = state.ui ?? {};
  state.ui.settingsReturnView = getActiveView();
  closeSettings();
  setActiveView(view);
  render();
}

function returnFromSettingsLinkedPage() {
  state.ui = state.ui ?? {};
  const returnView = state.ui.settingsReturnView ?? 'tasks';
  setActiveView(returnView);
  openSettings();
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
  if (!isCurrentActorOwnerSuperAdmin()) {
    alert('Owner access required.');
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
}

function closeAdminConsole() {
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

function openGroupRenameModal(label) {
  if (!groupRenameModal || !groupRenameInput) return;
  renameGroupLabel = label;
  groupRenameInput.value = label;
  groupRenameModal.classList.remove('hidden');
  groupRenameInput.focus();
  groupRenameInput.select();
}

function closeGroupRenameModal() {
  groupRenameModal?.classList.add('hidden');
  renameGroupLabel = null;
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

async function renameTaskGroup(label, nextName) {
  const updatedName = normalizeTitleInput(nextName);
  if (!updatedName || updatedName === label) return;
  const workspaceId = state.workspace?.id;
  if (!workspaceId) return;
  const sections = state.taskSections ?? [];
  const existingSection = sections.find(section => section.workspace_id === workspaceId && section.label === label);
  const duplicateSection = sections.find(section => section.workspace_id === workspaceId && section.label === updatedName);
  if (existingSection) {
    if (duplicateSection && duplicateSection !== existingSection) {
      state.taskSections = sections.filter(section => section !== existingSection);
    } else {
      existingSection.label = updatedName;
      existingSection.updated_at = nowIso();
    }
  }
  const tasks = Object.values(state.tasks ?? {});
  for (const task of tasks) {
    if (task.workspace_id !== workspaceId) continue;
    const currentLabel = (task.group_label ?? '').trim();
    if (currentLabel !== label) continue;
    await updateTaskRecord(task.id, { group_label: updatedName });
  }
  render();
}

function showTaskGroupContextMenu(label, x, y) {
  if (!taskContextMenu) return;
  if (openMenu && openMenu !== taskContextMenu) {
    openMenu.classList.add('hidden');
  }
  taskContextMenu.innerHTML = '';

  const renameItem = document.createElement('button');
  renameItem.type = 'button';
  renameItem.className = 'workspace-menu-item';
  renameItem.textContent = 'Rename section';
  renameItem.addEventListener('click', () => {
    taskContextMenu.classList.add('hidden');
    openMenu = null;
    openGroupRenameModal(label);
  });
  taskContextMenu.appendChild(renameItem);

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.className = 'workspace-menu-item';
  deleteItem.textContent = 'Delete section';
  deleteItem.addEventListener('click', async () => {
    taskContextMenu.classList.add('hidden');
    openMenu = null;
    const confirmed = confirm(`Delete section "${label}"? Tasks will be moved out of the section.`);
    if (!confirmed) return;
    await deleteTaskSection(label);
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
  const isSelected = selected.includes(taskId);
  taskContextMenu.innerHTML = '';

  const selectItem = document.createElement('button');
  selectItem.type = 'button';
  selectItem.className = 'workspace-menu-item';
  selectItem.textContent = isSelected ? 'Deselect task' : 'Select task';
  selectItem.addEventListener('click', () => {
    if (isSelected) {
      setSelectedTaskIds(selected.filter(id => id !== taskId));
    } else {
      setSelectedTaskIds([...selected, taskId]);
    }
    taskContextMenu.classList.add('hidden');
    openMenu = null;
  });
  taskContextMenu.appendChild(selectItem);

  const workflowLink = getWorkflowInstanceLinkByTaskId(taskId);
  if (workflowLink && (workflowLink.if_applicable || workflowLink.dismissed_at)) {
    const dismissItem = document.createElement('button');
    dismissItem.type = 'button';
    dismissItem.className = 'workspace-menu-item';
    if (workflowLink.dismissed_at) {
      dismissItem.textContent = 'Restore workflow task';
      dismissItem.addEventListener('click', () => {
        restoreWorkflowTask(taskId);
        taskContextMenu.classList.add('hidden');
        openMenu = null;
        render();
      });
    } else {
      dismissItem.textContent = 'Mark not applicable';
      dismissItem.addEventListener('click', () => {
        dismissWorkflowTask(taskId);
        taskContextMenu.classList.add('hidden');
        openMenu = null;
        render();
      });
    }
    taskContextMenu.appendChild(dismissItem);
  }

  const bulkEditItem = document.createElement('button');
  bulkEditItem.type = 'button';
  bulkEditItem.className = 'workspace-menu-item';
  bulkEditItem.textContent = 'Bulk edit';
  bulkEditItem.disabled = selected.length === 0 && !isSelected;
  bulkEditItem.addEventListener('click', () => {
    if (!selected.length) {
      setSelectedTaskIds([taskId]);
    } else if (!isSelected) {
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
  bulkDeleteItem.disabled = selected.length === 0 && !isSelected;
  bulkDeleteItem.addEventListener('click', async () => {
    if (!selected.length) {
      setSelectedTaskIds([taskId]);
    } else if (!isSelected) {
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
  clearItem.disabled = selected.length === 0;
  clearItem.addEventListener('click', () => {
    clearSelectedTasks();
    taskContextMenu.classList.add('hidden');
    openMenu = null;
  });
  taskContextMenu.appendChild(clearItem);

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
    editorPriority.value = task.priority ?? 'medium';
    populateProjectSelect(editorProject, task.project_id ?? '', true);
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
    populateStatusSelect(editorStatus, task.status ?? getDefaultStatusKey());
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

  const endBoundary = (() => {
    if (rule.endType !== 'on' || !rule.endDate) return null;
    const [year, month, day] = rule.endDate.split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  })();

  const nextCount = Number(notice.recurrence_occurrence_count ?? 0) + 1;
  if (rule.endType === 'after' && Number(rule.endCount) > 0 && nextCount >= Number(rule.endCount)) {
    return null;
  }

  let next = getNextFrom(base);
  if (!next || Number.isNaN(next.getTime())) return null;
  const now = Date.now();
  let guard = 0;
  while (next.getTime() <= now && guard < 1000) {
    next = getNextFrom(next);
    if (!next || Number.isNaN(next.getTime())) return null;
    guard += 1;
  }
  if (endBoundary && next.getTime() > endBoundary.getTime()) return null;
  return next;
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

modalCancel.addEventListener('click', closeTaskModal);
taskModal.querySelector('.modal-backdrop').addEventListener('click', closeTaskModal);
modalAssignee?.addEventListener('change', () => {
  setAssigneeLabelInputVisibility(modalAssignee, modalAssigneeLabelRow, modalAssigneeLabel);
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
settingsClose?.addEventListener('click', closeSettings);
settingsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
settingsOpenDataTransfer?.addEventListener('click', () => {
  openSettingsLinkedPage('data-transfer');
});
settingsOpenAuditLog?.addEventListener('click', () => {
  openSettingsLinkedPage('audit-log');
});
settingsOpenAutomation?.addEventListener('click', () => {
  openSettingsLinkedPage('automation');
});
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
taskTypesOpen?.addEventListener('click', openTaskTypesModal);
taskTypesClose?.addEventListener('click', closeTaskTypesModal);
taskTypesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTaskTypesModal);
storeRulesOpen?.addEventListener('click', openStoreRulesModal);
storeRulesClose?.addEventListener('click', closeStoreRulesModal);
storeRulesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeStoreRulesModal);

editorCancel?.addEventListener('click', closeTaskEditor);
editorClose?.addEventListener('click', closeTaskEditor);
editorTitle?.addEventListener('input', () => scheduleTaskEditorAutosave('title', 700));
editorTitle?.addEventListener('blur', () => scheduleTaskEditorAutosave('title-blur', 200));
editorType?.addEventListener('change', () => scheduleTaskEditorAutosave('type', 300));
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
  const currentLabel = renameGroupLabel;
  if (!currentLabel) {
    closeGroupRenameModal();
    return;
  }
  const nextName = groupRenameInput?.value.trim() ?? '';
  if (!nextName) {
    groupRenameInput?.focus();
    return;
  }
  if (nextName === currentLabel) {
    closeGroupRenameModal();
    return;
  }
  await renameTaskGroup(currentLabel, nextName);
  closeGroupRenameModal();
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
    title,
    description_md: description,
    priority: editorPriority.value,
    project_id: editorProject.value || null,
    assignee_user_id: assigneeUserId,
    assignee_label: assigneeLabel || null,
    recurrence_interval: recurrence.interval ?? null,
    recurrence_unit: recurrence.interval ? recurrence.unit : null,
    reminder_offset_days: parseInt(editorReminder.value, 10) || null,
    auto_debit: task.auto_debit ?? 0,
    due_at: fromDatetimeLocal(editorDue.value),
    status: nextStatus
  };
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
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = project.id;
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
  const inviteToken = getInviteTokenFromUrl();
  await hydrateAuthSession();
  if (isAuthGateEnabled() && !isAuthenticatedActor()) {
    clearWorkspaceDomainData();
    render();
    if (inviteToken) {
      openAuthModal('invite', { inviteToken });
    } else {
      openAuthModal('login');
    }
    return;
  }
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
