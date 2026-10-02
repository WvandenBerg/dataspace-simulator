import { createContext } from 'react';

// Lets dataset details deep in a participant's popup open the hub dialog without threading a prop through every layer.
export const OpenHubProfileContext = createContext(null);
