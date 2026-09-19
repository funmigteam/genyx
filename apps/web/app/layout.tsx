import './styles.css';
import './genyx.css';
import { Providers } from './providers';
export const metadata = { title: 'GENYX', description: 'PLAY · BUILD · RISE' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
