/* main.tsx — mounts the static design shell off mock fixtures.
   lat4-ui replaces the mock data with the live store/SSE/endpoints. */
import { render } from 'preact';
import { App } from './components/App';
import './styles/surface-blocks.css';

const root = document.getElementById('root');
if (root) render(<App />, root);
