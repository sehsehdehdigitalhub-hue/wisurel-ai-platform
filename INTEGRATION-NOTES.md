# Wisurel Automation Platform — Integration Notes

## 1. Setup order
1. Run `schema.sql` in the Supabase SQL editor.
2. Insert the org: `insert into organizations (name, slug, primary_color) values ('Wisurel Ogbomosho Farm','wisurel','#22C55E');`
3. Deploy the edge function: `supabase functions deploy ai-proxy`
4. Set the secret: `supabase secrets set MODEL_API_KEY=sk-ant-...`
5. In `app.html`, replace any direct `fetch('https://api.anthropic.com/...')` call with a call to
   your function URL: `https://<project>.functions.supabase.co/ai-proxy`. No API key ever ships to the browser.

## 2. Client call pattern (drop-in replacement for the old direct fetch)
```js
async function callAI(action, payload) {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/ai-proxy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, org_id: currentOrgId, project_id: currentProjectId, ...payload })
  });
  if (!res.ok) throw new Error('AI request failed');
  return res.json();
}

// new automation from a plain-English prompt
const blueprint = await callAI('blueprint', { prompt: userPrompt });

// project chat turn
const { reply } = await callAI('chat', { message: userMessage });
```

## 3. "Update vs Branch" modal — trigger + logic
Trigger this whenever a user opens a project from the sidebar/project list that already has data:

```js
function openProject(project) {
  if (project.hasExistingData) {
    showModal({
      title: 'You are opening a previous project',
      body: 'How would you like to proceed?',
      options: [
        { label: 'Update Existing', action: () => loadBranch(project.trunkBranchId, { append: true }) },
        { label: 'Branch New Work', action: () => createBranch(project.id, project.trunkBranchId) }
      ]
    });
  } else {
    loadBranch(project.trunkBranchId, { append: false });
  }
}

async function createBranch(projectId, parentBranchId) {
  const label = prompt('Name this branch (e.g. "Receipts – July 2026")');
  const { data } = await supabase.from('project_branches').insert({
    project_id: projectId,
    parent_branch_id: parentBranchId,
    label,
    blueprint: currentTrunkBlueprint, // same schema, isolated rows
  }).select().single();
  loadBranch(data.id, { append: false });
}
```

## 4. Camera + universal upload — one pipeline
```html
<input type="file" id="fileInput" multiple hidden />
<input type="file" id="cameraInput" accept="image/*" capture="environment" hidden />

<button onclick="fileInput.click()">📁 Browse Files</button>
<button onclick="cameraInput.click()">📷 Take Photo</button>
<div id="dropzone">Drag & drop anything here</div>
```
```js
[fileInput, cameraInput].forEach(el =>
  el.addEventListener('change', e => ingestFiles(e.target.files))
);
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  ingestFiles(e.dataTransfer.files);
});

function ingestFiles(fileList) {
  [...fileList].forEach(uploadToSupabaseAndQueue); // any mime type, no filtering
}
```
`capture="environment"` opens the rear camera directly on mobile — no extra library needed. Both
paths call the same `ingestFiles`, so there's exactly one upload/processing code path to maintain.

## 5. Multi-project chat ("open other chats for automation projects")
- Sidebar lists `projects` (scoped by RLS to the logged-in org automatically).
- "+ New Automation" → prompts for plain English → calls `blueprint` action → creates a `projects`
  row + a trunk `project_branches` row with that blueprint → opens a fresh chat/workspace for it.
- Each project's chat history lives in `messages`, so switching projects is just switching
  `project_id` — no cross-contamination between automations.

## 6. Branding checklist (no Anthropic/Claude exposure)
- All model calls go through `ai-proxy` — confirmed above.
- UI copy says "Wisurel AI" (or your chosen product name), never "Claude" or "Anthropic".
- System prompts in the edge function explicitly instruct the model not to name itself — already
  set in `index.ts`.
- Don't put "Powered by Claude" anywhere in the shipped product if you want it fully white-label;
  this is your choice to make (not an Anthropic requirement) — using the API this way is standard.

## 7. Suggested build order
1. Wire `app.html` to the edge function (kills the exposed-key risk immediately).
2. Ship the multi-project sidebar + trunk branch creation.
3. Add the Update/Branch modal.
4. Add camera + universal upload.
5. Job queue (`jobs` table + a cron-triggered edge function) once you're past ~50 files/day —
   don't build this before you need it.
