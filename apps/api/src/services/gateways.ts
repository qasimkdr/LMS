import crypto from 'node:crypto';

/**
 * JazzCash "Page Redirection" (hosted checkout, API v1.1).
 * The parent's browser posts these fields to JazzCash; JazzCash posts the result back to our return URL.
 * pp_SecureHash = HMAC-SHA256(integritySalt, integritySalt & sorted non-empty pp_ values), upper-case hex.
 * Verify field names and response codes against your JazzCash sandbox before going live.
 */
export const JAZZCASH_URLS = {
  sandbox: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
  live: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
};

export function jazzcashHash(fields: Record<string, string>, integritySalt: string): string {
  const values = Object.keys(fields)
    .filter((k) => k.toLowerCase().startsWith('pp') && k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] !== undefined && fields[k] !== null)
    .sort()
    .map((k) => fields[k]);
  return crypto.createHmac('sha256', integritySalt).update([integritySalt, ...values].join('&')).digest('hex').toUpperCase();
}

/** yyyyMMddHHmmss in Pakistan time (JazzCash expects local time). */
function pkTime(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}${g('month')}${g('day')}${g('hour')}${g('minute')}${g('second')}`;
}

export function jazzcashCheckout(opts: {
  merchantId: string;
  password: string;
  integritySalt: string;
  sandbox: boolean;
  txnRef: string;
  amount: number;
  billReference: string;
  description: string;
  returnUrl: string;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const fields: Record<string, string> = {
    pp_Version: '1.1',
    pp_TxnType: '',
    pp_Language: 'EN',
    pp_MerchantID: opts.merchantId,
    pp_SubMerchantID: '',
    pp_Password: opts.password,
    pp_BankID: '',
    pp_ProductID: '',
    pp_TxnRefNo: opts.txnRef,
    // Amount in paisa, no decimals.
    pp_Amount: String(Math.round(opts.amount * 100)),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: pkTime(now),
    pp_BillReference: opts.billReference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'fee',
    pp_Description: opts.description.replace(/[^A-Za-z0-9 ,.-]/g, '').slice(0, 100),
    pp_TxnExpiryDateTime: pkTime(new Date(now.getTime() + 24 * 3600 * 1000)),
    pp_ReturnURL: opts.returnUrl,
    ppmpf_1: '',
    ppmpf_2: '',
    ppmpf_3: '',
    ppmpf_4: '',
    ppmpf_5: '',
  };
  fields.pp_SecureHash = jazzcashHash(fields, opts.integritySalt);
  return { action: opts.sandbox ? JAZZCASH_URLS.sandbox : JAZZCASH_URLS.live, fields };
}

/** Checks the hash JazzCash sent back. '000' (and '121') mean paid. */
export function jazzcashResult(body: Record<string, string>, integritySalt: string) {
  const sent = String(body.pp_SecureHash ?? '').toUpperCase();
  const valid = sent.length > 0 && sent === jazzcashHash(body, integritySalt);
  const code = String(body.pp_ResponseCode ?? '');
  return {
    valid,
    txnRef: String(body.pp_TxnRefNo ?? ''),
    amount: Number(body.pp_Amount ?? 0) / 100,
    success: ['000', '121'].includes(code),
    pending: ['124', '157'].includes(code),
    code,
    message: String(body.pp_ResponseMessage ?? ''),
  };
}
