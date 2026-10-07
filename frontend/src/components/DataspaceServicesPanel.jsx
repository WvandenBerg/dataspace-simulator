import React from 'react';
import { Compass, ListChecks, Lock } from 'lucide-react';

import './Components.css';

/**
 * The services a dataspace runs, as opposed to the participants in it.
 *
 * Discovery is shown locked on: a dataspace without it is not a dataspace, and
 * saying so is worth more here than a switch nobody may flip. The vocabulary
 * service is the optional one, because the textbook dataspace does not have it.
 */
const DataspaceServicesPanel = ({ vocabularyEnabled, onVocabularyChange, validatorEnabled, onValidatorChange }) => {
    // Keep clicks from reaching the container's pan handler
    const swallowPointerDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <div className="services-panel" onPointerDown={swallowPointerDown}>
            <div className="services-panel-title">Dataspace services</div>

            <div className="services-panel-row is-locked">
                <Compass size={14} className="services-panel-icon" />
                <span className="services-panel-label">Discovery Service</span>
                <Lock size={12} className="services-panel-lock" />
            </div>

            <label className="services-panel-row">
                <img
                    src="/assets/sth-logo.svg"
                    alt=""
                    className="services-panel-icon services-panel-icon-logo"
                    draggable={false}
                />
                <span className="services-panel-label">Vocabulary Service</span>
                <input
                    type="checkbox"
                    className="services-panel-switch"
                    checked={vocabularyEnabled}
                    onChange={(e) => onVocabularyChange(e.target.checked)}
                />
            </label>

            {/* Nested under the hub, because it checks the catalog against the profile the hub holds. */}
            <label
                className={`services-panel-row is-nested${vocabularyEnabled ? '' : ' is-locked'}`}
                title={vocabularyEnabled ? undefined : 'Runs on the Vocabulary Service'}
            >
                <ListChecks size={14} className="services-panel-icon" />
                <span className="services-panel-label">Metadata Validator</span>
                <input
                    type="checkbox"
                    className="services-panel-switch"
                    checked={vocabularyEnabled && validatorEnabled}
                    disabled={!vocabularyEnabled}
                    onChange={(e) => onValidatorChange(e.target.checked)}
                />
            </label>
        </div>
    );
};

export default DataspaceServicesPanel;
