import { Publication, Journal, JournalMetric } from '../models/index.js';
import { lookupByIssn } from '../providers/scopusSerial.js';
import { ProviderError } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const STALE_MS = 7 * 864e5;

export async function upsertMetrics(journalId, metrics) {
  for (const m of metrics) {
    await JournalMetric.updateOne(
      { journal: journalId, metric: m.metric, reportingYear: m.reportingYear, subjectCategory: m.subjectCategory || '', source: m.source },
      { $set: { value: m.value, retrievedAt: m.retrievedAt || new Date() } },
      { upsert: true }
    );
  }
}

/** Group journal-type publications by ISSN set, look each journal up once, link publications. */
export async function syncJournals({ force = false, onProgress } = {}) {
  const pubs = await Publication.find({ venueType: 'journal', issn: { $exists: true, $ne: [] } }).select('issn venue').lean();
  const noIssn = await Publication.countDocuments({ venueType: 'journal', $or: [{ issn: { $exists: false } }, { issn: { $size: 0 } }] });

  // Union ISSNs that belong to the same journal (print + electronic can appear on different papers)
  const groups = [];
  for (const p of pubs) {
    const g = groups.find((x) => p.issn.some((i) => x.issns.has(i)));
    if (g) { p.issn.forEach((i) => g.issns.add(i)); g.pubIds.push(p._id); }
    else groups.push({ issns: new Set(p.issn), pubIds: [p._id], name: p.venue });
  }

  const out = { journals: groups.length, found: 0, notFound: 0, skippedFresh: 0, failed: 0, papersWithoutIssn: noIssn, errors: [] };
  let done = 0;
  for (const g of groups) {
    onProgress?.(++done, groups.length, g.name);
    const issns = [...g.issns];
    let journal = await Journal.findOne({ issn: { $in: issns } });
    if (journal && !force && journal.lastFetchedAt && Date.now() - journal.lastFetchedAt < STALE_MS) {
      out.skippedFresh++;
      await Publication.updateMany({ _id: { $in: g.pubIds } }, { $set: { journal: journal._id } });
      continue;
    }
    try {
      let res = null;
      for (const i of issns) { res = await lookupByIssn(i); if (res) break; }
      if (!res) {
        journal = journal || new Journal({ title: g.name || issns[0], issn: issns });
        journal.scopusStatus = 'not_found'; journal.lastFetchedAt = new Date();
        await journal.save();
        out.notFound++;
      } else {
        journal = journal || new Journal();
        Object.assign(journal, res.journal, { issn: [...new Set([...(journal.issn || []), ...res.journal.issn, ...issns])], scopusStatus: 'found', lastFetchedAt: new Date() });
        await journal.save();
        await upsertMetrics(journal._id, res.metrics);
        out.found++;
      }
      await Publication.updateMany({ _id: { $in: g.pubIds } }, { $set: { journal: journal._id } });
    } catch (e) {
      out.failed++; out.errors.push(`${g.name}: ${e.message}`.slice(0, 160));
      logger.error({ journal: g.name, err: e.message }, 'journal sync failed');
      if (e instanceof ProviderError && ['auth', 'entitlement', 'rate_limited'].includes(e.kind)) { out.stoppedEarly = e.kind; break; }
    }
  }
  return out;
}
