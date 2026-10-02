import { createContext } from 'react';

// Lets dataset details deep in a participant's popup open the hub dialog without threading a prop through every layer.
// Null while the hub is off or off the ring, which also means nothing may be looked up in it.
export const OpenHubProfileContext = createContext(null);
