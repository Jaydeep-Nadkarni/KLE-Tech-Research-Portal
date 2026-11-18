import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });

// ---- Faculty (no publication arrays: those live in FacultyPublication)
const facultySchema = new Schema({
  name: { type: String, required: true, trim: true },
  designation: String,
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  department: { type: String, default: 'Computer Science and Engineering' }, // inferred from the HOD account (hod_cse@); correct it if wrong
  active: { type: Boolean, default: true },
  scholarProfileUrl: String,
  profileVerification: { type: String, enum: ['unverified', 'verified', 'needs_review'], default: 'unverified' },
  // Latest author-level profile per provider (name, h-index, affiliations...). Each value carries source + retrievedAt.
  profiles: { type: Map, of: Schema.Types.Mixed, default: {} },
  sync: { type: Map, of: new Schema({ lastAttemptAt: Date, lastSuccessAt: Date, status: String, error: String, count: Number }, { _id: false }), default: {} },
}, { timestamps: true });

// ---- Identifiers, one row per (faculty, type, value)
const identifierSchema = new Schema({
  faculty: { ...ref('Faculty'), required: true, index: true },
  type: { type: String, enum: ['scopus', 'orcid', 'scholar', 'email', 'openalex'], required: true },
  value: { type: String, required: true },
  status: { type: String, enum: ['unverified', 'verified', 'conflict', 'rejected'], default: 'unverified' },
  conflictWith: [ref('Faculty')],
  note: String,
  source: { type: String, default: 'import' },
  verifiedAt: Date,
  verifiedBy: String,
}, { timestamps: true });
identifierSchema.index({ type: 1, value: 1 });
identifierSchema.index({ faculty: 1, type: 1, value: 1 }, { unique: true });

// ---- Normalized publication (one per real-world paper)
const indexState = (vals) => ({ status: { type: String, enum: vals, default: vals.at(-1) }, checkedAt: Date, evidence: String });
const publicationSchema = new Schema({
  title: { type: String, required: true },
  titleKey: { type: String, index: true },
  abstract: String,
  doi: { type: String, index: true, sparse: true },
  eid: { type: String, index: true, sparse: true },
  authors: [{ name: String, orcid: String, _id: false }],
  year: { type: Number, index: true },
  date: String,
  venue: String,
  publisher: String,
  issn: [String],
  isbn: [String],
  volume: String, issue: String, pages: String, articleNumber: String,
  type: String,
  venueType: { type: String, enum: ['journal', 'conference', 'book', 'other', 'unknown'], default: 'unknown' },
  keywords: [String],
  fields: [String],
  journal: { type: Schema.Types.ObjectId, ref: 'Journal', index: true },
  countries: [String], // ISO codes of author institutions (from OpenAlex only)
  url: String, pdfUrl: String,
  openAccess: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  citations: { type: Map, of: new Schema({ count: Number, influential: Number, via: String, retrievedAt: Date }, { _id: false }), default: {} },
  // Independent per-source status. Scopus "indexed" only ever comes from a Scopus record.
  indexing: {
    scopus: indexState(['indexed', 'not_found', 'pending']),
    webOfScience: indexState(['indexed', 'not_found', 'pending', 'not_checked']),
    googleScholar: indexState(['listed', 'not_found', 'pending', 'not_checked']),
    orcid: indexState(['linked', 'not_linked', 'not_checked']),
    openalex: indexState(['listed', 'not_found', 'not_checked']),
    semanticScholar: indexState(['listed', 'not_found', 'not_checked']),
    crossref: indexState(['doi_registered', 'doi_not_found', 'not_checked']),
  },
  providers: [String],
  verificationStatus: { type: String, enum: ['auto', 'pending_review', 'verified', 'rejected'], default: 'auto' },
}, { timestamps: true });

// ---- Raw provider records (provenance never lost)
const providerRecordSchema = new Schema({
  provider: { type: String, required: true },
  externalId: { type: String, required: true },
  publication: { ...ref('Publication'), index: true },
  faculty: { ...ref('Faculty'), index: true },
  normalized: Schema.Types.Mixed,
  raw: Schema.Types.Mixed,
  fetchedAt: Date,
}, { timestamps: true });
providerRecordSchema.index({ provider: 1, externalId: 1, faculty: 1 }, { unique: true });

const facultyPublicationSchema = new Schema({
  faculty: { ...ref('Faculty'), required: true, index: true },
  publication: { ...ref('Publication'), required: true, index: true },
  authorPosition: Number,
  matchConfidence: { type: Number, min: 0, max: 1 },
  matchedBy: [String],
  verificationStatus: { type: String, enum: ['auto', 'pending_review', 'verified', 'rejected'], default: 'auto' },
}, { timestamps: true });
facultyPublicationSchema.index({ faculty: 1, publication: 1 }, { unique: true });

const citationSnapshotSchema = new Schema({
  publication: { ...ref('Publication'), index: true },
  provider: String, count: Number, influential: Number, retrievedAt: { type: Date, default: Date.now },
});

const verificationTaskSchema = new Schema({
  type: { type: String, enum: ['identifier_conflict', 'uncertain_duplicate', 'uncertain_author_match'], required: true },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  faculty: [ref('Faculty')],
  payload: Schema.Types.Mixed,
  dedupeKey: { type: String, unique: true, sparse: true },
  resolution: String, resolvedBy: String, resolvedAt: Date,
}, { timestamps: true });

const syncLogSchema = new Schema({
  faculty: { ...ref('Faculty'), index: true },
  provider: String,
  status: { type: String, enum: ['success', 'skipped', 'failed', 'partial'] },
  fetched: Number, created: Number, updated: Number,
  errorKind: String, message: String,
  startedAt: Date, finishedAt: Date,
});

const journalSchema = new Schema({
  title: { type: String, required: true },
  publisher: String,
  issn: [{ type: String, index: true }],
  aggregationType: String,
  scopusSourceId: { type: String, index: true, sparse: true },
  scopusStatus: { type: String, enum: ['found', 'not_found', 'unchecked'], default: 'unchecked' },
  scopusCoverage: { start: Number, end: Number },
  subjectAreas: [{ code: String, name: String, _id: false }],
  scopusUrl: String,
  lastFetchedAt: Date,
}, { timestamps: true });

// One row per (journal, metric, reporting year, subject category, source): history is preserved, never overwritten.
const journalMetricSchema = new Schema({
  journal: { ...ref('Journal'), required: true, index: true },
  metric: { type: String, required: true }, // CiteScore | CiteScore Tracker | SJR | SNIP | SJR Best Quartile | SJR Quartile | H index
  value: { type: Schema.Types.Mixed, required: true },
  source: { type: String, required: true }, // e.g. 'Scopus Serial Title API', 'SCImago Journal Rank 2024 file'
  reportingYear: { type: Number, required: true },
  subjectCategory: { type: String, default: '' },
  retrievedAt: { type: Date, default: Date.now },
});
journalMetricSchema.index({ journal: 1, metric: 1, reportingYear: 1, subjectCategory: 1, source: 1 }, { unique: true });

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: String,
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['super_admin', 'hod', 'faculty', 'viewer'], default: 'viewer' },
  faculty: ref('Faculty'),
  active: { type: Boolean, default: true },
  lastLoginAt: Date,
}, { timestamps: true });

const auditLogSchema = new Schema({
  user: ref('User'), userEmail: String, action: { type: String, index: true }, target: String, meta: Schema.Types.Mixed,
  at: { type: Date, default: Date.now, index: true },
});

const syncJobSchema = new Schema({
  scope: { type: String, enum: ['faculty', 'all', 'journals'], required: true },
  faculty: ref('Faculty'),
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', index: true },
  progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 }, current: String },
  results: [Schema.Types.Mixed],
  error: String,
  triggeredBy: String,
  startedAt: Date, finishedAt: Date,
}, { timestamps: true });

// Point-in-time copy of author-level metrics per provider, so history is never overwritten.
const metricSnapshotSchema = new Schema({
  faculty: { ...ref('Faculty'), required: true, index: true },
  provider: { type: String, required: true },
  mode: String, // api | manual
  metrics: Schema.Types.Mixed,
  retrievedAt: { type: Date, default: Date.now },
  recordedBy: String,
});
metricSnapshotSchema.index({ faculty: 1, provider: 1, retrievedAt: -1 });

export const ResearcherMetricSnapshot = mongoose.model('ResearcherMetricSnapshot', metricSnapshotSchema);
// Manual label for a co-author (the data sources cannot say whether someone is a student, for example).
const personTagSchema = new Schema({
  key: { type: String, required: true, unique: true }, // "oa:A5012345678" or "name:surname i"
  name: String,
  category: { type: String, enum: ['student', 'research_scholar', 'faculty_other_dept', 'external'], required: true },
  note: String,
  setBy: String,
}, { timestamps: true });

export const PersonTag = mongoose.model('PersonTag', personTagSchema);
export const Journal = mongoose.model('Journal', journalSchema);
export const JournalMetric = mongoose.model('JournalMetric', journalMetricSchema);
export const User = mongoose.model('User', userSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export const SyncJob = mongoose.model('SyncJob', syncJobSchema);
export const Faculty = mongoose.model('Faculty', facultySchema);
export const ResearcherIdentifier = mongoose.model('ResearcherIdentifier', identifierSchema);
export const Publication = mongoose.model('Publication', publicationSchema);
export const ProviderRecord = mongoose.model('ProviderRecord', providerRecordSchema);
export const FacultyPublication = mongoose.model('FacultyPublication', facultyPublicationSchema);
export const CitationSnapshot = mongoose.model('CitationSnapshot', citationSnapshotSchema);
export const VerificationTask = mongoose.model('VerificationTask', verificationTaskSchema);
export const SyncLog = mongoose.model('SyncLog', syncLogSchema);
