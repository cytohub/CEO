/**
 * Where each search result opens. One place, so routes owned by other
 * workstreams (thread, document, source viewer, commitments, risks) can be
 * re-pointed without touching the search code.
 */
export const links = {
  thread: (id: string) => `/brain/threads/${id}`,
  document: (id: string) => `/documents/${id}`,
  /** View Source for any ingested item (event, notes, message). */
  source: (sourceItemId: string) => `/brain/sources/${sourceItemId}`,
  event: (sourceItemId: string, meetingId?: string | null) => (meetingId ? links.meeting(meetingId) : links.source(sourceItemId)),
  notes: (sourceItemId: string, meetingId?: string | null) => (meetingId ? links.meeting(meetingId) : links.source(sourceItemId)),
  commitment: (id: string) => `/commitments?commitment=${id}`,
  task: (id: string) => `/tasks?task=${id}`,
  meeting: (id: string) => `/upcoming?meeting=${id}`,
  decision: (id: string) => `/decisions/${id}`,
  milestone: (id: string) => `/milestones?milestone=${id}`,
  goal: (id: string) => `/goals/${id}`,
  deal: (companyId: string | null | undefined) => (companyId ? links.company(companyId) : "/scoreboard"),
  risk: (id: string) => `/risks?risk=${id}`,
  opportunity: (id: string) => `/risks?opportunity=${id}`,
  company: (id: string) => `/resources/companies/${id}`,
  person: (id: string) => `/resources/people/${id}`,
  project: (name: string) => `/search?q=${encodeURIComponent(`Show everything related to ${name}`)}`,
  resource: (id: string) => `/resources?resource=${id}`,
  insight: (id: string) => `/brain?insight=${id}`,
  search: (q: string) => `/search?q=${encodeURIComponent(q)}`,
};
