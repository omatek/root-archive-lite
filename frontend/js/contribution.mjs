import { CONFIG, TYPES } from './config.mjs';
import { $, focusHeading } from './dom.mjs';

export function createContribution(getCourses, reload) {
  const dialog = $('contribution-dialog');
  const form = $('contribution-form');
  let token = '', user = null, editing = null, busy = false, trigger = null;
  let googleReady = false;
  const course = $('contribution-course');
  const type = $('contribution-type');
  type.append(new Option('Choose a type', ''), ...TYPES.map(t => new Option(t, t)));
  $('file-help').textContent = `PDF only · up to ${CONFIG.maxFileSize / 1024 / 1024} MiB.`;

  function status(message) {
    $('submission-message').textContent = message;
    $('submission-message').hidden = !message;
  }
  function updateControls() {
    $('auth-status').textContent = !token ? 'Not signed in.' : !user ? 'Checking eligibility…'
      : user.can_upload ? (user.admin ? 'Signed in · Student and administrator' : 'Signed in · Eligible student')
      : user.admin ? 'Signed in · Administrator (edit/delete only)' : 'This account is not eligible to contribute.';
    $('signout').hidden = !token;
    $('google-signin-slot').hidden = Boolean(token);
    $('retry-signin').hidden = googleReady || Boolean(token);
    $('submit-resource').disabled = busy || !user || !(editing ? editing.can_edit : user.can_upload);
    $('contribution-fields').disabled = busy;
    $('close-contribution').disabled = busy;
    $('save-close').disabled = busy;
    $('signout').disabled = busy;
  }
  function clearSession() {
    token = ''; user = null;
    window.google?.accounts.id.disableAutoSelect();
    updateControls();
  }
  async function receiveCredential(response) {
    token = response.credential; user = null;
    updateControls(); await reload();
  }
  async function loadGoogle() {
    if (googleReady) return;
    if (CONFIG.googleClientId.startsWith('REPLACE')) {
      status('Configure the academic Google client ID in js/config.mjs first.'); return;
    }
    $('retry-signin').disabled = true;
    try {
      if (!window.google?.accounts?.id) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true; script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error('Google sign-in could not load.')); };
          document.head.append(script);
        });
      }
      google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: receiveCredential, auto_select: false });
      google.accounts.id.renderButton($('google-signin-slot'), { theme: 'outline', size: 'large' });
      googleReady = true; status(''); updateControls();
    } catch (error) { status(error.message); }
    finally { $('retry-signin').disabled = false; }
  }
  function refreshCourses() {
    const previous = course.value;
    const query = $('course-picker-search').value.trim().toLowerCase();
    course.replaceChildren(new Option('Choose a course', ''));
    for (const c of getCourses()) {
      if (c.id === previous || `${c.id} ${c.name}`.toLowerCase().includes(query)) {
        course.append(new Option(`${c.id} · ${c.name}`, c.id));
      }
    }
    course.value = previous;
  }
  function open(courseId, button, resource = null) {
    editing = resource; trigger = button; form.reset(); status('');
    refreshCourses(); course.value = courseId || '';
    $('contribution-heading').textContent = editing ? 'Edit resource' : 'Contribute a resource';
    $('contribution-description').textContent = editing ? 'Change metadata without reuploading the PDF.' : 'Share a PDF. It will appear immediately.';
    $('submit-resource').textContent = editing ? 'Save changes' : 'Upload resource';
    for (const id of ['course-field', 'file-field', 'contributor-field']) $(id).hidden = Boolean(editing);
    course.required = $('contribution-file').required = !editing;
    if (editing) {
      $('contribution-title').value = editing.title; type.value = editing.type;
      $('contribution-semester').value = editing.semester;
    }
    updateControls(); dialog.showModal(); focusHeading($('contribution-heading'));
    if (!token) loadGoogle();
  }
  function close() {
    if (busy) return;
    dialog.close();
    if (trigger?.isConnected) trigger.focus();
  }
  async function write(path, method, body) {
    const headers = { Authorization: `Bearer ${token}` };
    if (method === 'PATCH') headers['Content-Type'] = 'application/json';
    const response = await fetch(CONFIG.apiUrl + path, { method, body, headers });
    const result = await response.json();
    if (response.status === 401) { clearSession(); await reload(); }
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !token) return;
    const data = new FormData(form);
    const isEdit = Boolean(editing);
    if (!isEdit && data.get('file').size > CONFIG.maxFileSize) {
      status('The PDF exceeds the upload limit.'); return;
    }
    busy = true; updateControls(); status(isEdit ? 'Saving…' : 'Uploading…');
    try {
      if (isEdit) {
        await write(`/resources/${editing.id}`, 'PATCH', JSON.stringify({ title: data.get('title'), type: data.get('type'), semester: data.get('semester') }));
      } else await write('/upload', 'POST', data);
      await reload();
      busy = false; close();
      alert(isEdit ? 'Resource updated.' : 'Resource uploaded.');
    } catch (error) { status(error.message); }
    finally { busy = false; updateControls(); }
  });
  $('course-picker-search').addEventListener('input', refreshCourses);
  $('retry-signin').addEventListener('click', loadGoogle);
  $('close-contribution').addEventListener('click', close);
  $('save-close').addEventListener('click', close);
  $('signout').addEventListener('click', async () => { close(); clearSession(); await reload(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  return {
    open, refreshCourses, clearSession,
    token: () => token,
    setUser(value) {
      user = value;
      if (editing) editing.can_edit = Boolean(getCourses().flatMap(c => c.resources).find(r => r.id === editing.id)?.can_edit);
      updateControls();
    },
    async remove(resource) {
      if (!confirm(`Permanently delete “${resource.title}” and its PDF?`)) return;
      try { await write(`/resources/${resource.id}`, 'DELETE'); await reload(); }
      catch (error) { alert(error.message); await reload(); }
    }
  };
}
