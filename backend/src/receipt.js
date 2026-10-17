import PDFDocument from 'pdfkit';

export function receiptPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: 'A4', margin: 48, compress: true});
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.fontSize(22).text('Payment receipt');
    doc.moveDown().fontSize(12).text(`Order: ${payload.order_id}`);
    doc.text(`Paid at: ${payload.paid_at}`);
    doc.moveDown();
    for (const item of payload.items) {
      doc.text(`${item.variant_id} x ${item.quantity} - PKR ${(item.unit_price_minor / 100).toFixed(2)}`);
    }
    doc.moveDown();
    doc.text(`Subtotal: PKR ${(payload.subtotal_minor / 100).toFixed(2)}`);
    doc.text(`Discount: PKR ${(payload.discount_minor / 100).toFixed(2)}`);
    doc.fontSize(16).text(`Total: PKR ${(payload.total_minor / 100).toFixed(2)}`);
    doc.end();
  });
}
