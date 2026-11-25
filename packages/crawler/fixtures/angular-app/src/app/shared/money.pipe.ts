import { Pipe, PipeTransform } from '@angular/core';
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform { transform(v: number) { return `$${v}`; } }
