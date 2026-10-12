// A sandbox with allow-scripts but no allow-forms blocks native submission before
// submit handlers. Keep browser validation while dispatching only local UI events.
function submit(form, button) {
  if (form.method === 'dialog') { form.closest('dialog')?.close(button?.value ?? ''); return; }
  if (form.reportValidity()) form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button ?? null }));
}
document.addEventListener('click', event => {
  const button = event.target.closest?.('button,input[type=submit]');
  if (button?.type !== 'submit' || !button.form) return;
  event.preventDefault(); submit(button.form, button);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.target.tagName !== 'INPUT' || !event.target.form) return;
  if (['checkbox', 'radio', 'button', 'submit'].includes(event.target.type)) return;
  event.preventDefault(); const form = event.target.form;
  submit(form, form.querySelector('button[type=submit],button:not([type]),input[type=submit]'));
});
