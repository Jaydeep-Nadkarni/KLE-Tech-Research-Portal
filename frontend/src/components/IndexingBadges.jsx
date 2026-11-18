import { Badge } from './ui/Ui';

// Each source plays a different role; the label wording reflects what it can and cannot prove.
export const INDEX_META = {
  scopus: { label: 'Scopus', role: 'Citation database', values: { indexed: ['Indexed', 'good'], not_found: ['Not found', 'bad'], pending: ['Verification pending', 'warn'] } },
  webOfScience: { label: 'Web of Science', role: 'Citation database', values: { indexed: ['Indexed', 'good'], not_found: ['Not found', 'bad'], pending: ['Verification pending', 'warn'], not_checked: ['Not checked', 'neutral'] } },
  googleScholar: { label: 'Google Scholar', role: 'Search engine', values: { listed: ['Listed', 'good'], not_found: ['Not found', 'bad'], pending: ['Verification pending', 'warn'], not_checked: ['Not checked', 'neutral'] } },
  orcid: { label: 'ORCID', role: 'Researcher identifier registry', values: { linked: ['Linked', 'info'], not_linked: ['Not linked', 'neutral'], not_checked: ['Not checked', 'neutral'] } },
  openalex: { label: 'OpenAlex', role: 'Scholarly metadata provider', values: { listed: ['Listed', 'info'], not_found: ['Not found', 'neutral'], not_checked: ['Not checked', 'neutral'] } },
  semanticScholar: { label: 'Semantic Scholar', role: 'Scholarly metadata provider', values: { listed: ['Listed', 'info'], not_found: ['Not found', 'neutral'], not_checked: ['Not checked', 'neutral'] } },
  crossref: { label: 'Crossref', role: 'DOI registry', values: { doi_registered: ['DOI registered', 'info'], doi_not_found: ['DOI not found', 'neutral'], not_checked: ['Not checked', 'neutral'] } },
};

export function IndexBadge({ source, state }) {
  const m = INDEX_META[source];
  const [text, tone] = m.values[state?.status] || ['Not checked', 'neutral'];
  return <Badge tone={tone} title={`${m.label} (${m.role})${state?.evidence ? ': ' + state.evidence : ''}`}>{m.label}: {text}</Badge>;
}

/** Compact: only the two most informative badges in tables. */
export function IndexBadgesCompact({ indexing }) {
  return (
    <div className="flex flex-wrap gap-1">
      <IndexBadge source="scopus" state={indexing?.scopus} />
      {indexing?.webOfScience?.status === 'indexed' && <IndexBadge source="webOfScience" state={indexing.webOfScience} />}
      {indexing?.crossref?.status === 'doi_registered' && <Badge tone="info" title="DOI registered with Crossref (not an indexing claim)">DOI</Badge>}
    </div>
  );
}
