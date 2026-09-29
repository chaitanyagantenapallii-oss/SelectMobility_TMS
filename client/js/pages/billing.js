'use strict';

const BillingPage = {
  async render(container) {
    const { data } = await Api.get('/dashboard/billing');
    const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
    container.innerHTML = `<div class="grid cols-4" style="margin-bottom:18px">
      ${this.card('Client billing / vehicle', money(data.clientRate), 'Monthly, before GST', 'ok')}
      ${this.card('Vendor cost / vehicle', money(data.vendorRate), 'Monthly contracted rate', 'info')}
      ${this.card('Gross contribution', money(data.grossContribution), `${data.activeVehicles} active vehicles`, 'warn')}
      ${this.card('Included trips', `${data.includedTripsPerVehicle}`, 'Per vehicle / month', 'danger')}
    </div><div class="card"><div class="card-head"><div><h3>Commercial rate card</h3><span class="desc">Bharat Forge Ltd client commercial versus vendor cost</span></div></div><div class="card-body tight"><table class="table"><thead><tr><th>Commercial item</th><th>Vendor cost</th><th>Client billing</th><th>Margin</th><th>Basis</th></tr></thead><tbody>
      <tr><td>Sedan vehicle package</td><td>${money(data.vendorRate)}</td><td>${money(data.clientRate)}</td><td><span class="pill ok">${money(data.clientRate-data.vendorRate)}</span></td><td>22 days · 3 trips/day</td></tr>
      <tr><td>Additional sedan trip</td><td>${money(data.extraVendorTrip)}</td><td>${money(data.extraClientTrip)}</td><td><span class="pill ok">${money(data.extraClientTrip-data.extraVendorTrip)}</span></td><td>Beyond 66 included trips</td></tr>
      <tr><td>Monthly package total</td><td>${money(data.vendorBase)}</td><td>${money(data.clientBase)}</td><td><strong>${money(data.grossContribution)}</strong></td><td>${data.activeVehicles} active vehicles</td></tr>
    </tbody></table></div></div><div class="card"><div class="card-head"><div><h3>Invoices</h3><span class="desc">Generated from verified trip and vehicle commercials</span></div></div><div class="card-body tight"><table class="table"><thead><tr><th>Invoice</th><th>Client</th><th>Period</th><th>Taxable value</th><th>GST</th><th>Total</th><th>Status</th></tr></thead><tbody>${(data.invoices||[]).map(i=>`<tr><td>${i.id}</td><td>${i.organisation}</td><td>${i.period}</td><td>${money(i.subtotal||i.total)}</td><td>${money(i.gstAmount)}</td><td><strong>${money(i.total)}</strong></td><td><span class="pill ${i.status==='paid'?'ok':'warn'}">${i.status}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  },
  card(label, value, hint, tone) { return `<div class="stat ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${hint}</div></div>`; },
};
