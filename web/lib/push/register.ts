/**
 * Web push is the scheduled jobs' notice sender (C2 track I; lib/jobs/notify.ts registerNoticeSender). Server-only.
 * Importing this module registers it, once per process: lib/jobs/index.ts imports it, and instrumentation.ts loads
 * lib/jobs when the server starts, so POST /api/dev/tick and the JOBS=1 loop send through it.
 *
 * Subscriptions come through the push sender's narrow store (lib/subject/push.ts), the only way a job reaches his and
 * her phones. Without VAPID keys (and with the developer tools off) the sender sends nothing (lib/push/vapid.ts).
 */
import { registerNoticeSender } from "@/lib/jobs/notify";
import { pushEntryStore } from "@/lib/subject/push";
import { createWebPushSender, storeSubscriptions } from "./sender";

registerNoticeSender(createWebPushSender({ port: () => storeSubscriptions(pushEntryStore()) }));
