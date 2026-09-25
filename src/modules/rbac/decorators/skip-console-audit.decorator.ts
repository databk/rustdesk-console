import { SetMetadata } from '@nestjs/common';

/** Marks a route whose service already creates a detailed console audit entry. */
export const SKIP_CONSOLE_AUDIT_KEY = 'skipConsoleAudit';
export const SkipConsoleAudit = () => SetMetadata(SKIP_CONSOLE_AUDIT_KEY, true);
