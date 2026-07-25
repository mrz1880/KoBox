export interface MailDelivery {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
}

// One delivery attempt over the local Postfix relay. Throwing is the signal
// the outbox retry ladder feeds on — adapters never swallow errors (§5.6).
export interface MailTransportPort {
  deliver(mail: MailDelivery): Promise<void>;
}
