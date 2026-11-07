// The portal's own pages (held out, provisioning, capacity, failure), in the
// same look as public/login.html: the Nova dark aurora, the glass card.

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

const page = ({ title, lead, body = '', refreshSeconds = 0, contact }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${refreshSeconds ? `<meta http-equiv="refresh" content="${Number(refreshSeconds)}" />` : ''}
<title>Nova Bots</title>
<link rel="icon" type="image/svg+xml" href="/nova-icon.svg" />
<style>
  :root {
    --bg: #060010; --panel: rgba(22, 28, 60, 0.58); --ink: #f4f3ff; --ink-2: rgba(228, 228, 245, 0.7);
    --ink-3: rgba(228, 228, 245, 0.4); --violet: #7c5cff; --violet-2: #a78bfa; --cyan: #22d3ee;
    --line: rgba(150, 140, 220, 0.18); --radius-lg: 18px;
    --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    min-height: 100vh; margin: 0; font-family: var(--font); background: var(--bg); color: var(--ink);
    display: grid; place-items: center; padding: 24px 16px; -webkit-font-smoothing: antialiased;
    background-image: radial-gradient(60rem 40rem at 15% -10%, rgba(124, 92, 255, 0.28), transparent 60%),
      radial-gradient(50rem 36rem at 110% 110%, rgba(34, 211, 238, 0.18), transparent 60%);
  }
  main { width: 100%; max-width: 440px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-size: 12.5px; margin-bottom: 14px; }
  .brand em { font-style: normal; color: var(--violet-2); font-weight: 600; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 30px 28px;
    backdrop-filter: blur(18px); box-shadow: 0 30px 80px -30px rgba(124, 92, 255, 0.45); }
  h1 { font-size: 22px; line-height: 1.25; margin: 0 0 8px; letter-spacing: -0.01em; }
  h1 em { font-style: normal; background: linear-gradient(90deg, var(--violet-2), var(--cyan)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { color: var(--ink-2); line-height: 1.6; margin: 0 0 12px; font-size: 14.5px; }
  a { color: var(--cyan); }
  .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,0.08); overflow: hidden; margin: 18px 0 14px; }
  .bar span { display: block; height: 100%; width: 40%; border-radius: 4px; background: linear-gradient(90deg, var(--violet), var(--cyan)); animation: slide 1.6s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
  .foot { color: var(--ink-3); font-size: 12.5px; margin-top: 14px; }
  @media (prefers-reduced-motion: reduce) { .bar span { animation: none; width: 100%; } }
</style>
</head>
<body>
<main>
  <div class="brand"><span>Nova Bots · <em>your AI team on your hardware</em></span></div>
  <div class="card">
    <h1>${title}</h1>
    <p>${lead}</p>
    ${body}
    <p class="foot">Questions: <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a> · <a href="/account">Account</a></p>
  </div>
</main>
</body>
</html>`

// Shared mode: signed in, but the one shared engine is not theirs to enter.
export const heldPage = (contact) => page({
  title: 'Your workspace is <em>being prepared</em>',
  lead: 'Your account is signed in. Every account gets a private Nova Bots workspace of its own; yours is not switched on yet. We will let you know as soon as it is.',
  contact,
})

// Isolated mode: the account's own engine is being created or started.
export const provisioningPage = (contact, { first = false } = {}) => page({
  title: first ? 'Setting up your <em>private workspace</em>…' : 'Waking up your <em>workspace</em>…',
  lead: first
    ? 'Your own Nova Bots engine is being created: its own Bots, memory and files, not shared with anyone. This takes about 30 seconds the first time.'
    : 'Your workspace was asleep to save resources. It is starting again with all your Bots and files, usually in about 15 seconds.',
  body: '<div class="bar" role="progressbar" aria-label="Starting"><span></span></div><p class="foot">This page refreshes on its own.</p>',
  refreshSeconds: 3,
  contact,
})

export const capacityPage = (contact) => page({
  title: 'All workspaces are <em>busy</em>',
  lead: 'The maximum number of workspaces is running right now. Yours is safe and will start as soon as a slot frees up. This page tries again on its own.',
  body: '<div class="bar"><span></span></div>',
  refreshSeconds: 20,
  contact,
})

export const failedPage = (contact) => page({
  title: 'Your workspace could <em>not start</em>',
  lead: 'Something went wrong while starting your private workspace. Your data is safe. Try again in a minute; if it keeps happening, write to us.',
  body: '<p><a href="/app/">Try again</a></p>',
  contact,
})
