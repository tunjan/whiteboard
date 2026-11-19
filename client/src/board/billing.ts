import { toast } from '@/components/ui/toast';

/** Leave for Stripe: Checkout to subscribe, or the portal to change or cancel. */
export async function openBilling(kind: 'checkout' | 'portal'): Promise<void> {
  try {
    const res = await fetch(`/api/billing/${kind}`, { method: 'POST', credentials: 'include' });
    const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !body?.url) throw new Error(body?.error ?? 'Billing is unavailable right now');
    window.location.assign(body.url);
  } catch (error) {
    toast.add({ title: error instanceof Error ? error.message : 'Billing failed', type: 'error' });
  }
}
