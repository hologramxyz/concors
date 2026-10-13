// The mobile bundle is one inlined script that loads in full at launch, and pdf.js would make it
// half again as large for a file type rarely opened on a phone. Images still preview here.
export default function PdfView() {
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      Open PDFs from the Concors desktop app.
    </p>
  );
}
