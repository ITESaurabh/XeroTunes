import React from 'react';
import { Tooltip } from '@mui/material';
import { Icon } from '@iconify/react';
import helpIcon from '@iconify/icons-fluent/question-circle-16-regular';
import { AMBION_DESCRIPTION } from '../../config/surround';

const AmbionHelp: React.FC = () => (
  <Tooltip title={AMBION_DESCRIPTION} placement="right">
    <span
      tabIndex={0}
      aria-label="What is Ambion?"
      style={{
        display: 'inline-flex',
        verticalAlign: 'middle',
        marginLeft: 6,
        opacity: 0.7,
        cursor: 'help',
      }}
    >
      <Icon icon={helpIcon} width="1em" />
    </span>
  </Tooltip>
);

export default AmbionHelp;
