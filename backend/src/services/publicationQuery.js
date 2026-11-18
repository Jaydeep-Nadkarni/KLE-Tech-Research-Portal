import mongoose from 'mongoose';
import { Publication, FacultyPublication } from '../models/index.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function queryPublications(q, { facultyIds } = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const f = {};
  const scoped = facultyIds ?? (q.facultyId ? [q.facultyId] : null);
  if (scoped) {
    const pubIds = await FacultyPublication.find({ faculty: { $in: scoped }, verificationStatus: { $ne: 'rejected' } }).distinct('publication');
    f._id = { $in: pubIds };
  }
  if (q.q) f.$or = [{ title: new RegExp(esc(q.q), 'i') }, { doi: new RegExp(esc(q.q.toLowerCase())) }, { venue: new RegExp(esc(q.q), 'i') }];
  if (q.year) f.year = Number(q.year);
  if (q.yearFrom || q.yearTo) f.year = { ...(q.yearFrom ? { $gte: Number(q.yearFrom) } : {}), ...(q.yearTo ? { $lte: Number(q.yearTo) } : {}) };
  if (q.scopus) f['indexing.scopus.status'] = q.scopus;
  if (q.wos) f['indexing.webOfScience.status'] = q.wos;
  if (q.venueType) f.venueType = q.venueType;
  if (q.publisher) f.publisher = q.publisher;
  if (q.openAccess) f.openAccess = q.openAccess;
  f.verificationStatus = q.verification ? q.verification : { $ne: 'rejected' }; // rejected records stay hidden unless asked for
  const src = ['scopus', 'openalex', 'semanticscholar', 'crossref', 'googlescholar', 'webofscience'].includes(q.citeSource) ? q.citeSource : 'scopus';
  if (q.minCites || q.maxCites) f[`citations.${src}.count`] = { ...(q.minCites ? { $gte: Number(q.minCites) } : {}), ...(q.maxCites ? { $lte: Number(q.maxCites) } : {}) };

  const sortKey = { year: 'year', title: 'titleKey', citations: `citations.${src}.count`, venue: 'venue' }[q.sort] || 'year';
  const sort = { [sortKey]: q.order === 'asc' ? 1 : -1, _id: 1 };
  const [items, total] = await Promise.all([
    Publication.find(f).sort(sort).skip((page - 1) * limit).limit(limit).select('-abstract').lean(),
    Publication.countDocuments(f),
  ]);
  const links = await FacultyPublication.find({ publication: { $in: items.map((i) => i._id) } }).populate('faculty', 'name').lean();
  const byPub = new Map();
  for (const l of links) byPub.set(String(l.publication), [...(byPub.get(String(l.publication)) || []), { id: l.faculty?._id, name: l.faculty?.name, authorPosition: l.authorPosition }]);
  return { items: items.map((i) => ({ ...i, faculty: byPub.get(String(i._id)) || [] })), total, page, limit, pages: Math.ceil(total / limit), citeSource: src };
}

export async function publicationFacets(facultyIds) {
  const match = {};
  if (facultyIds) match._id = { $in: await FacultyPublication.find({ faculty: { $in: facultyIds } }).distinct('publication') };
  const [years, publishers] = await Promise.all([
    Publication.distinct('year', match),
    Publication.aggregate([{ $match: { ...match, publisher: { $ne: null } } }, { $group: { _id: '$publisher', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 40 }]),
  ]);
  return { years: years.filter(Boolean).sort((a, b) => b - a), publishers: publishers.map((p) => p._id) };
}

export const isId = (id) => mongoose.isValidObjectId(id);
