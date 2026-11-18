import { Publication, FacultyPublication, ProviderRecord, CitationSnapshot, AuditLog } from '../models/index.js';
import { uniq } from '../utils/normalize.js';

/**
 * Merge publication `dropId` into `keepId`. Provenance is preserved: provider records, faculty links and
 * citation snapshots are re-pointed, per-provider citations and indexing statuses are carried over, and the
 * removed record is stored whole in the audit log so the merge can be inspected or reversed by hand.
 */
export async function mergePublications(keepId, dropId, { userEmail = 'system', reason = '' } = {}) {
  if (String(keepId) === String(dropId)) throw new Error('Cannot merge a publication into itself');
  const keep = await Publication.findById(keepId);
  const drop = await Publication.findById(dropId);
  if (!keep || !drop) throw new Error('Publication not found');
  const dropSnapshot = drop.toObject();

  // Carry over what only the dropped record knows. Keep's own bibliographic data wins.
  for (const [prov, c] of drop.citations.entries()) if (!keep.citations.get(prov)) keep.citations.set(prov, c);
  for (const k of Object.keys(drop.indexing.toObject())) {
    const d = drop.indexing[k], t = keep.indexing[k];
    const touched = (x) => x?.checkedAt || (x?.status && !['pending', 'not_checked'].includes(x.status));
    if (touched(d) && !touched(t)) keep.indexing[k] = d;
    if (k === 'googleScholar' && d?.status === 'listed') keep.indexing[k] = d;
  }
  keep.providers = uniq([...keep.providers, ...drop.providers]);
  for (const f of ['doi', 'eid', 'abstract', 'venue', 'publisher', 'url', 'pdfUrl', 'year']) if (!keep[f] && drop[f]) keep[f] = drop[f];
  if (!keep.authors?.length && drop.authors?.length) keep.authors = drop.authors;
  await keep.save();

  await ProviderRecord.updateMany({ publication: drop._id }, { $set: { publication: keep._id } });
  await CitationSnapshot.updateMany({ publication: drop._id }, { $set: { publication: keep._id } });

  for (const l of await FacultyPublication.find({ publication: drop._id })) {
    const existing = await FacultyPublication.findOne({ faculty: l.faculty, publication: keep._id });
    if (existing) {
      existing.matchedBy = uniq([...existing.matchedBy, ...l.matchedBy]);
      existing.matchConfidence = Math.max(existing.matchConfidence || 0, l.matchConfidence || 0);
      if (!existing.authorPosition && l.authorPosition) existing.authorPosition = l.authorPosition;
      await existing.save();
      await l.deleteOne();
    } else {
      l.publication = keep._id;
      await l.save();
    }
  }
  await drop.deleteOne();
  await AuditLog.create({ userEmail, action: 'publication_merge', target: String(keep._id), meta: { reason, removed: dropSnapshot } });
  return keep;
}

/** Hide a publication from all counts (links become "rejected") while keeping the record for audit. */
export async function rejectPublication(pubId, faculty, { userEmail = 'system', reason = '' } = {}) {
  const res = await FacultyPublication.updateMany({ publication: pubId, ...(faculty ? { faculty } : {}) }, { $set: { verificationStatus: 'rejected' } });
  await Publication.updateOne({ _id: pubId }, { $set: { verificationStatus: 'rejected' } });
  await AuditLog.create({ userEmail, action: 'publication_reject', target: String(pubId), meta: { reason, links: res.modifiedCount } });
}
