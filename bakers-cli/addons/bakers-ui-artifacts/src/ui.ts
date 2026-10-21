// The entry module: it registers at IMPORT time, which is Storybook-faithful for
// the addon author and is why the kernel drains the collector once rather than
// handing a store around (spec D3).
import { register } from '@bakers-build/addon-bakers-ui/ui';
import { ArtifactsTabScreen } from './panel.js';

register('bakers/artifacts', (api) => api.add(ArtifactsTabScreen));
