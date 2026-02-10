const DEFAULT_EMAIL_PROVIDER = String(process.env.BRIANHUB_EMAIL_PROVIDER ?? 'log').trim().toLowerCase();
const EMAIL_FROM = String(process.env.BRIANHUB_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL ?? 'no-reply@brianhub.local').trim();
const APP_ORIGIN = String(process.env.BRIANHUB_APP_ORIGIN ?? 'http://localhost:5173').trim().replace(/\/+$/, '');

function formatInviteEmailText({ inviteUrl, workspaceName, invitedByEmail, expiresAt }) {
  const workspaceLabel = workspaceName ? `for workspace "${workspaceName}" ` : '';
  const inviterLabel = invitedByEmail ? ` by ${invitedByEmail}` : '';
  return [
    `You have been invited to BrianHub ${workspaceLabel}${inviterLabel}.`,
    '',
    'Use this link to create your account:',
    inviteUrl,
    '',
    `This invite expires at: ${expiresAt}`,
    '',
    'If this was not expected, you can ignore this email.'
  ].join('\n');
}

function buildInviteUrl(inviteToken) {
  return `${APP_ORIGIN}/apps/web/?invite_token=${encodeURIComponent(inviteToken)}`;
}

async function sendWithResend({ to, subject, text, html }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required when BRIANHUB_EMAIL_PROVIDER=resend');
  }
  if (!EMAIL_FROM) {
    throw new Error('BRIANHUB_EMAIL_FROM or RESEND_FROM_EMAIL is required for email sending');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      text,
      html
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
  const payload = await response.json();
  return {
    provider: 'resend',
    accepted: true,
    message_id: payload?.id ?? null
  };
}

function sendWithLog({ to, subject, text }) {
  // Intentionally logs only invite metadata and body text for local/dev use.
  console.log('[email:log]', JSON.stringify({
    to,
    from: EMAIL_FROM,
    subject,
    text
  }));
  return {
    provider: 'log',
    accepted: true,
    message_id: null
  };
}

async function sendEmail(payload) {
  if (DEFAULT_EMAIL_PROVIDER === 'resend') {
    return sendWithResend(payload);
  }
  return sendWithLog(payload);
}

export async function sendInviteEmail({ toEmail, inviteToken, workspaceName, invitedByEmail, expiresAt }) {
  const inviteUrl = buildInviteUrl(inviteToken);
  const subject = 'BrianHub invitation';
  const text = formatInviteEmailText({
    inviteUrl,
    workspaceName,
    invitedByEmail,
    expiresAt
  });
  const html = `<p>${text
    .split('\n')
    .map((line) => line
      ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : '&nbsp;')
    .join('</p><p>')}</p>`;
  const delivery = await sendEmail({
    to: toEmail,
    subject,
    text,
    html
  });
  return {
    ...delivery,
    invite_url: inviteUrl
  };
}
