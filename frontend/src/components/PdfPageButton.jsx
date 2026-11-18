import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';

/** Downloads everything on the page (cards, charts, tables) as a PDF. Libraries load only when clicked. */
export default function PdfPageButton({ title, subtitle, filename, label = 'Full page PDF', disabled }) {
  const [state, setState] = useState({ busy: false, err: '' });
  const run = async () => {
    setState({ busy: true, err: '' });
    try {
      // let any in-flight chart animation settle before capturing
      await new Promise((r) => setTimeout(r, 400));
      const { exportPageToPdf } = await import('../utils/pdfExport.js');
      await exportPageToPdf(document.querySelector('main'), { title, subtitle, filename });
      setState({ busy: false, err: '' });
    } catch (e) { setState({ busy: false, err: e.message || 'Could not create the PDF' }); }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {state.err && <span className="text-xs text-red-700" role="alert">{state.err}</span>}
      <button className="btn" onClick={run} disabled={state.busy || disabled} title="Download this whole page, including all graphs, as a PDF">
        {state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} {state.busy ? 'Preparing…' : label}
      </button>
    </span>
  );
}
