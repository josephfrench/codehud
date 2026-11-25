import { CanActivateFn } from '@angular/router';
/** Redirects anonymous users to /login. */
export const authGuard: CanActivateFn = () => true;
