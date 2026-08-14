/* main.tsx — mounts the static design shell off mock fixtures.
   lat4-ui replaces the mock data with the live store/SSE/endpoints. */
import { render } from 'preact';
import { App } from './components/App';
import { installCodeCopy } from './lib/copy-code';
import './styles/surface-blocks.css';

// One document-level listener for every fenced block's Copy button, on every surface — see copy-code.ts
// for why delegation rather than per-block handlers.
installCodeCopy();

const root = document.getElementById('root');
if (root) render(<App />, root);
