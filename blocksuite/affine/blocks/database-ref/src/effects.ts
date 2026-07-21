import { installDatabaseRefCascadeDelete } from './delete-guard';
import { installNestedDatabaseFullWidthGuard } from './database-override';
import { DatabaseRefBlockComponent } from './database-ref-block';

export function effects() {
  customElements.define('affine-database-ref', DatabaseRefBlockComponent);
  installDatabaseRefCascadeDelete();
  installNestedDatabaseFullWidthGuard();
}
