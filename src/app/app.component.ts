import { Component } from '@angular/core';
import { InhandCalculatorComponent } from './inhand-calculator.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [InhandCalculatorComponent],
  template: `<app-inhand-calculator />`,
})
export class AppComponent {}
