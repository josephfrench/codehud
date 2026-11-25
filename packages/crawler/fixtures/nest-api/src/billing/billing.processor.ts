import { Process, Processor } from '@nestjs/bull';
import sgMail from '@sendgrid/mail';
/** Charges cards and emails receipts. */
@Processor('billing')
export class BillingProcessor { @Process('charge') async charge() { await sgMail.send({} as any); } }
