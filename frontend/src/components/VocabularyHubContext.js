import { createContext } from 'react';

// Lets dataset details deep in a participant's popup open the hub dialog without threading a prop through every layer.
// Null while the hub is off or off the ring, which also means nothing may be looked up in it.
export const OpenHubProfileContext = createContext(null);

// The metadata validator's latest report, so any view of an entry can say how it fared. Null while it does not run.
export const ValidationReportContext = createContext(null);
