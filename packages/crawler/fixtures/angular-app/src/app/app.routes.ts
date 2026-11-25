import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'orders', canActivate: [authGuard], loadChildren: () => import('./orders/orders.routes').then((m) => m.ORDERS_ROUTES) },
  { path: '', redirectTo: 'orders', pathMatch: 'full' },
];
