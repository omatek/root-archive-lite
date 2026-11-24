// Public settings for the independent academic deployment.
export const CONFIG = {
  // Use local bindings only when developing on the documented local origin.
  apiUrl: typeof window !== 'undefined' && window.location.origin === 'http://localhost:8000'
    ? 'http://localhost:8787'
    : 'https://api-lite.rootamman.com',
  googleClientId: 'REPLACE_WITH_LITE_CLIENT_ID.apps.googleusercontent.com',
  maxFileSize: 10 * 1024 * 1024
};

export const TRACKS = ['CS', 'AI', 'Cybersecurity'];
export const TYPES = ['Practice Questions', 'Summary', 'Notes', 'Test Bank', 'Other'];
export const TYPE_HEADINGS = { 'Practice Questions': 'Practice Questions', Summary: 'Summaries', Notes: 'Notes', 'Test Bank': 'Test Banks', Other: 'Other resources' };
export const TRACK_LABELS = { CS: 'Computer Science', AI: 'Artificial Intelligence', Cybersecurity: 'Cybersecurity' };
