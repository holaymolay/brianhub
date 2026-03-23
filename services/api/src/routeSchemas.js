const UUID_V4_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const uuidSchema = { type: 'string', pattern: UUID_V4_PATTERN };
const nullableUuidSchema = { anyOf: [uuidSchema, { type: 'null' }] };
const boolishSchema = {
  anyOf: [
    { type: 'boolean' },
    { type: 'integer', enum: [0, 1] },
    { type: 'string', enum: ['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off'] }
  ]
};
const integerSchema = { type: 'integer' };
const nullableIntegerSchema = { anyOf: [integerSchema, { type: 'null' }] };
const dateTimeSchema = { type: 'string', format: 'date-time' };
const nullableDateTimeSchema = { anyOf: [dateTimeSchema, { type: 'null' }] };
const dateOnlySchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const nullableDateOnlySchema = { anyOf: [dateOnlySchema, { type: 'null' }] };
const shoppingItemStateSchema = {
  type: 'string',
  enum: ['pending', 'bought', 'substituted', 'unavailable']
};

function nonEmptyString(maxLength = 512) {
  return { type: 'string', minLength: 1, maxLength };
}

function nullableString(maxLength = 4096) {
  return { anyOf: [{ type: 'string', maxLength }, { type: 'null' }] };
}

const taskTagsSchema = {
  anyOf: [
    {
      type: 'array',
      maxItems: 64,
      uniqueItems: true,
      items: nonEmptyString(64)
    },
    { type: 'null' }
  ]
};

const changePayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entity_type', 'entity_id', 'action', 'payload'],
  properties: {
    entity_type: nonEmptyString(128),
    entity_id: nonEmptyString(128),
    action: nonEmptyString(64),
    client_mutation_id: { anyOf: [nonEmptyString(128), { type: 'null' }] },
    payload: {}
  }
};

const createTaskBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['workspace_id', 'title'],
  properties: {
    id: uuidSchema,
    workspace_id: uuidSchema,
    parent_id: nullableUuidSchema,
    project_id: nullableUuidSchema,
    group_label: nullableString(128),
    tags: taskTagsSchema,
    title: nonEmptyString(512),
    description_md: nullableString(50000),
    type_label: nullableString(128),
    recurrence_interval: nullableIntegerSchema,
    recurrence_unit: nullableString(32),
    reminder_offset_days: nullableIntegerSchema,
    auto_debit: boolishSchema,
    reminder_sent_at: nullableDateTimeSchema,
    recurrence_parent_id: nullableUuidSchema,
    recurrence_generated_at: nullableDateTimeSchema,
    template_id: nullableUuidSchema,
    template_state: nullableString(64),
    template_event_date: nullableDateTimeSchema,
    template_lead_days: nullableIntegerSchema,
    template_defer_until: nullableDateTimeSchema,
    template_prompt_pending: boolishSchema,
    assignee_user_id: nullableUuidSchema,
    assignee_label: nullableString(256),
    status: nullableString(64),
    priority: nonEmptyString(32),
    urgency: boolishSchema,
    start_at: nullableDateTimeSchema,
    due_at: nullableDateTimeSchema,
    completed_at: nullableDateTimeSchema,
    waiting_followup_at: nullableDateTimeSchema,
    next_checkin_at: nullableDateTimeSchema,
    sort_order: integerSchema,
    task_type: nonEmptyString(64)
  }
};

const updateTaskBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    project_id: nullableUuidSchema,
    group_label: nullableString(128),
    tags: taskTagsSchema,
    title: nonEmptyString(512),
    description_md: nullableString(50000),
    type_label: nullableString(128),
    recurrence_interval: nullableIntegerSchema,
    recurrence_unit: nullableString(32),
    reminder_offset_days: nullableIntegerSchema,
    auto_debit: boolishSchema,
    reminder_sent_at: nullableDateTimeSchema,
    recurrence_parent_id: nullableUuidSchema,
    recurrence_generated_at: nullableDateTimeSchema,
    template_id: nullableUuidSchema,
    template_state: nullableString(64),
    template_event_date: nullableDateTimeSchema,
    template_lead_days: nullableIntegerSchema,
    template_defer_until: nullableDateTimeSchema,
    template_prompt_pending: boolishSchema,
    assignee_user_id: nullableUuidSchema,
    assignee_label: nullableString(256),
    status: nullableString(64),
    priority: nonEmptyString(32),
    urgency: boolishSchema,
    start_at: nullableDateTimeSchema,
    due_at: nullableDateTimeSchema,
    completed_at: nullableDateTimeSchema,
    waiting_followup_at: nullableDateTimeSchema,
    next_checkin_at: nullableDateTimeSchema,
    sort_order: integerSchema,
    task_type: nonEmptyString(64),
    expected_updated_at: nullableDateTimeSchema
  }
};

const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      additionalProperties: true,
      properties: {
        code: nonEmptyString(64),
        message: nonEmptyString(2048),
        requestId: nonEmptyString(128),
        conflict: {
          type: 'object',
          additionalProperties: true
        }
      }
    }
  }
};

const taskResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'workspace_id', 'title', 'status'],
  properties: {
    id: uuidSchema,
    workspace_id: uuidSchema,
    parent_id: nullableUuidSchema,
    project_id: nullableUuidSchema,
    tags: {
      type: 'array',
      items: nonEmptyString(64)
    },
    title: nonEmptyString(512),
    status: { type: 'string', maxLength: 64 },
    updated_at: nullableDateTimeSchema
  }
};

const taskListResponseSchema = {
  type: 'array',
  items: taskResponseSchema
};

const authUserResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'org_id', 'display_name', 'email'],
  properties: {
    id: uuidSchema,
    org_id: uuidSchema,
    display_name: nonEmptyString(256),
    email: nonEmptyString(320),
    org_role: nullableString(64)
  }
};

const authWorkspaceResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'org_id', 'name', 'type'],
  properties: {
    id: uuidSchema,
    org_id: uuidSchema,
    name: nonEmptyString(256),
    type: nonEmptyString(64),
    role: nullableString(64)
  }
};

const authSessionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['authenticated', 'require_auth'],
  properties: {
    authenticated: { type: 'boolean' },
    require_auth: { type: 'boolean' },
    user: {
      anyOf: [authUserResponseSchema, { type: 'null' }]
    },
    session: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: true,
          required: ['id', 'expires_at'],
          properties: {
            id: uuidSchema,
            expires_at: dateTimeSchema
          }
        },
        { type: 'null' }
      ]
    },
    workspaces: {
      type: 'array',
      items: authWorkspaceResponseSchema
    },
    owner_email: nullableString(320),
    is_owner: { type: 'boolean' },
    is_admin: { type: 'boolean' }
  }
};

const syncPushResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['applied', 'deduped'],
  properties: {
    applied: integerSchema,
    deduped: integerSchema
  }
};

const syncPullResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes', 'next_cursor'],
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seq', 'entity_type', 'entity_id', 'action', 'payload', 'client_id', 'created_at'],
        properties: {
          seq: integerSchema,
          entity_type: nonEmptyString(128),
          entity_id: nonEmptyString(128),
          action: nonEmptyString(64),
          payload: { type: 'object', additionalProperties: true },
          client_id: nullableString(128),
          created_at: dateTimeSchema
        }
      }
    },
    next_cursor: integerSchema
  }
};

const routeSchemas = new Map([
  ['GET /health', {
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' }
        }
      }
    }
  }],
  ['POST /workspaces', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'type'],
      properties: {
        id: uuidSchema,
        name: nonEmptyString(256),
        type: nonEmptyString(64),
        org_id: uuidSchema,
        org_name: nullableString(256)
      }
    }
  }],
  ['GET /workspaces', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        org_id: uuidSchema
      }
    }
  }],
  ['POST /orgs', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        id: uuidSchema,
        name: nonEmptyString(256),
        workspace_id: nullableUuidSchema
      }
    }
  }],
  ['GET /users', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        org_id: uuidSchema,
        workspace_id: uuidSchema
      },
      anyOf: [{ required: ['org_id'] }, { required: ['workspace_id'] }]
    }
  }],
  ['POST /users', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['org_id'],
      properties: {
        id: uuidSchema,
        org_id: uuidSchema,
        workspace_id: nullableUuidSchema,
        display_name: nullableString(256),
        name: nullableString(256),
        email: nullableString(320),
        org_role: nullableString(64),
        archived: boolishSchema
      },
      anyOf: [{ required: ['display_name'] }, { required: ['name'] }]
    }
  }],
  ['PATCH /users/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        display_name: nullableString(256),
        email: nullableString(320),
        org_role: nullableString(64),
        archived: boolishSchema,
        workspace_id: nullableUuidSchema
      }
    }
  }],
  ['PATCH /auth/profile', {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        display_name: nullableString(256),
        email: nullableString(320)
      },
      anyOf: [{ required: ['display_name'] }, { required: ['email'] }]
    }
  }],
  ['GET /auth/settings', {
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['settings'],
        properties: {
          settings: {
            type: 'object',
            additionalProperties: true
          }
        }
      }
    }
  }],
  ['PATCH /auth/settings', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['settings'],
      properties: {
        settings: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['settings'],
        properties: {
          settings: {
            type: 'object',
            additionalProperties: true
          }
        }
      }
    }
  }],
  ['GET /auth/me', {
    response: {
      200: authSessionResponseSchema
    }
  }],
  ['POST /auth/login', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'password'],
      properties: {
        email: nonEmptyString(320),
        password: nonEmptyString(200)
      }
    },
    response: {
      200: authSessionResponseSchema
    }
  }],
  ['POST /auth/logout', {
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' }
        }
      }
    }
  }],
  ['POST /auth/invite/accept', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['invite_token', 'email', 'display_name', 'password'],
      properties: {
        invite_token: nonEmptyString(256),
        email: nonEmptyString(320),
        display_name: nonEmptyString(256),
        password: nonEmptyString(200)
      }
    },
    response: {
      200: authSessionResponseSchema
    }
  }],
  ['GET /admin/invites', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        org_id: uuidSchema,
        workspace_id: uuidSchema,
        status: { type: 'string', enum: ['all', 'pending', 'accepted', 'expired', 'revoked'] }
      }
    }
  }],
  ['POST /admin/invites', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'email'],
      properties: {
        workspace_id: uuidSchema,
        email: nonEmptyString(320),
        role: { type: 'string', enum: ['member', 'admin'] },
        org_id: nullableUuidSchema
      }
    }
  }],
  ['DELETE /admin/invites/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: uuidSchema
      }
    }
  }],
  ['GET /admin/users', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        org_id: uuidSchema,
        workspace_id: uuidSchema,
        include_archived: boolishSchema
      }
    }
  }],
  ['PATCH /admin/users/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: uuidSchema
      }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        display_name: nullableString(256),
        email: nullableString(320),
        org_role: nullableString(64),
        archived: boolishSchema,
        settings: {
          type: 'object',
          additionalProperties: true
        }
      }
    }
  }],
  ['POST /admin/users/:id/reset-password', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: uuidSchema
      }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['password'],
      properties: {
        password: nonEmptyString(200)
      }
    }
  }],
  ['POST /admin/users/:id/export', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: uuidSchema
      }
    }
  }],
  ['DELETE /admin/users/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: uuidSchema
      }
    }
  }],
  ['POST /admin/ownership/transfer', {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target_user_id: uuidSchema,
        target_email: nullableString(320)
      },
      anyOf: [{ required: ['target_user_id'] }, { required: ['target_email'] }]
    }
  }],
  ['GET /workspace-memberships', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: {
        workspace_id: uuidSchema
      }
    }
  }],
  ['POST /workspace-memberships', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'user_id'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        user_id: uuidSchema,
        role: nullableString(64),
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /workspace-memberships/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        role: nullableString(64),
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /workspace-memberships/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['PATCH /workspaces/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: nullableString(256),
        type: nullableString(64),
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /workspaces/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /projects', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /projects', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'name'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        name: nonEmptyString(256),
        kind: nullableString(64),
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /projects/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: nullableString(256),
        kind: nullableString(64),
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /projects/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /templates', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /templates', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'name'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        project_id: nullableUuidSchema,
        name: nonEmptyString(256),
        steps: { type: 'array', items: {} },
        lead_days: integerSchema,
        next_event_date: nullableDateTimeSchema,
        recurrence_interval: nullableIntegerSchema,
        recurrence_unit: nullableString(32),
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /templates/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        project_id: nullableUuidSchema,
        name: nullableString(256),
        steps: { type: 'array', items: {} },
        lead_days: integerSchema,
        next_event_date: nullableDateTimeSchema,
        recurrence_interval: nullableIntegerSchema,
        recurrence_unit: nullableString(32),
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /templates/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /statuses', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /statuses', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'label'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        key: nullableString(64),
        label: nonEmptyString(128),
        kind: nullableString(64),
        sort_order: integerSchema,
        kanban_visible: boolishSchema
      }
    }
  }],
  ['PATCH /statuses/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: nullableString(128),
        sort_order: integerSchema,
        kanban_visible: boolishSchema
      }
    }
  }],
  ['DELETE /statuses/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /task-types', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /task-types', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'name'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        name: nonEmptyString(128),
        is_default: boolishSchema,
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /task-types/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: nullableString(128),
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /task-types/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /notice-types', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /notice-types', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'label'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        key: nullableString(64),
        label: nonEmptyString(128)
      }
    }
  }],
  ['PATCH /notice-types/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: nullableString(128)
      }
    }
  }],
  ['DELETE /notice-types/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /notices', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /notices', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'title', 'notify_at'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        title: nonEmptyString(512),
        notify_at: dateTimeSchema,
        notice_type: nullableString(64),
        notice_sent_at: nullableDateTimeSchema,
        recurrence_interval: nullableIntegerSchema,
        recurrence_unit: nullableString(16),
        recurrence_rule_json: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'null' }] },
        recurrence_rule: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'null' }] },
        recurrence_occurrence_count: nullableIntegerSchema,
        dismissed_at: nullableDateTimeSchema
      }
    }
  }],
  ['PATCH /notices/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: nullableString(512),
        notify_at: nullableDateTimeSchema,
        notice_type: nullableString(64),
        notice_sent_at: nullableDateTimeSchema,
        recurrence_interval: nullableIntegerSchema,
        recurrence_unit: nullableString(16),
        recurrence_rule_json: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'null' }] },
        recurrence_rule: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'null' }] },
        recurrence_occurrence_count: nullableIntegerSchema,
        dismissed_at: nullableDateTimeSchema
      }
    }
  }],
  ['DELETE /notices/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /store-rules', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /store-rules', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'store_name'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        store_name: nonEmptyString(256),
        keywords_json: { anyOf: [{ type: 'string' }, { type: 'array', items: {} }, { type: 'object' }, { type: 'null' }] },
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /store-rules/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        store_name: nullableString(256),
        keywords_json: { anyOf: [{ type: 'string' }, { type: 'array', items: {} }, { type: 'object' }, { type: 'null' }] },
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /store-rules/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /shopping-lists', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /shopping-lists', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'name'],
      properties: {
        id: uuidSchema,
        workspace_id: uuidSchema,
        name: nonEmptyString(256),
        store_name: nullableString(256),
        scheduled_for: nullableDateOnlySchema,
        archived: boolishSchema
      }
    }
  }],
  ['PATCH /shopping-lists/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: nullableString(256),
        store_name: nullableString(256),
        scheduled_for: nullableDateOnlySchema,
        archived: boolishSchema
      }
    }
  }],
  ['DELETE /shopping-lists/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['GET /shopping-items', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace_id: uuidSchema,
        list_id: uuidSchema
      },
      anyOf: [{ required: ['workspace_id'] }, { required: ['list_id'] }]
    }
  }],
  ['POST /shopping-items', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['list_id'],
      properties: {
        list_id: uuidSchema,
        name: nullableString(512),
        is_checked: boolishSchema,
        sort_order: integerSchema,
        item_state: shoppingItemStateSchema,
        substitute_name: nullableString(512),
        items: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 512 },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: uuidSchema,
                  name: nonEmptyString(512),
                  is_checked: boolishSchema,
                  sort_order: integerSchema,
                  item_state: shoppingItemStateSchema,
                  substitute_name: nullableString(512)
                },
                required: ['name']
              }
            ]
          }
        }
      },
      anyOf: [{ required: ['name'] }, { required: ['items'] }]
    }
  }],
  ['PATCH /shopping-items/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        list_id: { type: 'string', format: 'uuid' },
        name: nullableString(512),
        is_checked: boolishSchema,
        sort_order: integerSchema,
        item_state: shoppingItemStateSchema,
        substitute_name: nullableString(512)
      }
    }
  }],
  ['DELETE /shopping-items/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    }
  }],
  ['POST /tasks/:id/convert-to-shopping-item', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['list_id'],
      properties: {
        list_id: uuidSchema
      }
    }
  }],
  ['POST /tasks', {
    body: createTaskBodySchema,
    response: {
      200: taskResponseSchema,
      400: errorResponseSchema
    }
  }],
  ['GET /tasks/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    response: {
      200: taskResponseSchema,
      404: errorResponseSchema
    }
  }],
  ['PATCH /tasks/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: updateTaskBodySchema,
    response: {
      200: taskResponseSchema,
      400: errorResponseSchema,
      404: errorResponseSchema
    }
  }],
  ['DELETE /tasks/:id', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    response: {
      200: {
        type: 'object',
        additionalProperties: false,
        required: ['deleted'],
        properties: {
          deleted: integerSchema,
          ids: {
            type: 'array',
            items: uuidSchema
          }
        }
      }
    }
  }],
  ['GET /tasks', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    },
    response: {
      200: taskListResponseSchema
    }
  }],
  ['GET /task-dependencies', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: { workspace_id: uuidSchema }
    }
  }],
  ['POST /task-dependencies', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id', 'depends_on_id'],
      properties: {
        task_id: uuidSchema,
        depends_on_id: uuidSchema
      }
    }
  }],
  ['DELETE /task-dependencies/:taskId/:dependsOnId', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId', 'dependsOnId'],
      properties: {
        taskId: uuidSchema,
        dependsOnId: uuidSchema
      }
    }
  }],
  ['GET /tasks/tree', {
    querystring: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: {
        workspace_id: uuidSchema,
        root_id: uuidSchema
      }
    }
  }],
  ['POST /tasks/:id/reparent', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['new_parent_id'],
      properties: { new_parent_id: nullableUuidSchema }
    }
  }],
  ['POST /tasks/:id/checkin', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['response'],
      properties: {
        response: { type: 'string', enum: ['yes', 'no', 'in-progress'] }
      }
    }
  }],
  ['POST /tasks/:id/reschedule', {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: uuidSchema }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['deltaMs'],
      properties: { deltaMs: { type: 'number' } }
    }
  }],
  ['POST /tasks/search', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: {
        workspace_id: uuidSchema,
        text: nullableString(512),
        status: nullableString(64),
        tag: nullableString(128)
      }
    },
    response: {
      200: taskListResponseSchema
    }
  }],
  ['POST /sync/push', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'changes'],
      properties: {
        workspace_id: uuidSchema,
        client_id: nullableString(128),
        changes: {
          type: 'array',
          maxItems: 5000,
          items: changePayloadSchema
        }
      }
    },
    response: {
      200: syncPushResponseSchema,
      400: errorResponseSchema,
      409: errorResponseSchema
    }
  }],
  ['POST /sync/pull', {
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id'],
      properties: {
        workspace_id: uuidSchema,
        cursor: nullableIntegerSchema
      }
    },
    response: {
      200: syncPullResponseSchema,
      400: errorResponseSchema
    }
  }],
  ['POST /ai/suggest', {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: nullableString(128),
              status: nullableString(64),
              title: nullableString(512)
            }
          }
        },
        context: {
          type: 'object',
          additionalProperties: true,
          properties: {
            time_available_minutes: integerSchema
          }
        }
      }
    }
  }]
]);

function applySchemaForRoute(routeOptions, schema) {
  if (!schema) return;
  routeOptions.schema = {
    ...(routeOptions.schema ?? {}),
    ...schema
  };
}

export function attachRouteSchemas(server) {
  server.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      const key = `${String(method).toUpperCase()} ${routeOptions.url}`;
      const schema = routeSchemas.get(key);
      if (!schema) continue;
      applySchemaForRoute(routeOptions, schema);
      break;
    }
  });
}
