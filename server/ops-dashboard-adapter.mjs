// Pure local boundary. Inputs must be supplied by a trusted server, never a phone.
// No network, database writes, authentication or delivery receipts occur here.
function id(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid stable ID');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  return new Date(value).toISOString();
}
export function mapAssignment(shift, binding) {
  if (!binding || binding.active !== true) throw new Error('Active authoritative binding required');
  for (const key of ['assignment_id', 'guard_id', 'site_id', 'auth_subject']) id(binding[key]);
  if (id(shift.id) !== binding.assignment_id) throw new Error('Assignment binding mismatch');
  // Display names cannot establish identity. Binding is an independent server record.
  if (!['scheduled', 'clocked_in', 'late', 'not_clocked_in'].includes(shift.status)) throw new Error('Assignment is not available');
  const starts_at = instant(shift.scheduled_start), ends_at = instant(shift.scheduled_end);
  if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new Error('Invalid schedule');
  return Object.freeze({ assignment_id: binding.assignment_id, guard_id: binding.guard_id,
    site_id: binding.site_id, starts_at, ends_at, source_updated_at: instant(shift.updated_at),
    source: 'ops_dashboard', status: shift.status });
}
const kinds = new Set(['incident', 'patrol_checkpoint', 'check_in', 'clock_in', 'clock_out']);
export function projectObservation(event, assignment) {
  // Call only after signature, enrollment, authorization and grant validation.
  for (const key of ['assignment_id', 'guard_id', 'site_id']) {
    if (id(event[key]) !== id(assignment[key])) throw new Error('Observation scope mismatch');
  }
  if (!kinds.has(event.kind)) throw new Error('Unsupported observation kind');
  return Object.freeze({ id: id(event.id), source: 'mercury_one',
    assignment_id: assignment.assignment_id, guard_id: assignment.guard_id, site_id: assignment.site_id,
    kind: event.kind, occurred_at: instant(event.occurred_at),
    // This is a separate observation, never a Homebase payroll clock or WhatsApp heartbeat.
    delivery_status: 'local_projection_only' });
}
