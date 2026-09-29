import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import { ALL, MANAGER, MSG_MAX_LENGTH, messageError, okAnswers } from './messages';
import { formatAge } from './driverLink';
import { useNow } from './DriverSetup';

const formatTime = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  hour: '2-digit',
  minute: '2-digit',
});

const failure = (e) => `Sending feilet (${e.message || 'ukjent feil'}). Prøv igjen.`;

// Messages render as plain text only (plan KTD17).
const textSx = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

const OkButton = ({ message, data }) => {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const answer = async () => {
    setPending(true);
    setError(null);
    try {
      await data.send({ to: MANAGER, text: 'OK', re: message.id });
      setSent(true);
    } catch (e) {
      setError(failure(e));
    } finally {
      setPending(false);
    }
  };
  if (sent) {
    return (
      <Typography variant="caption" color="success.main">
        OK sendt
      </Typography>
    );
  }
  return (
    <Box>
      <Button size="small" variant="outlined" disabled={pending} onClick={answer}>
        OK
      </Button>
      {error && (
        <Typography variant="caption" color="error" component="div">
          {error}
        </Typography>
      )}
    </Box>
  );
};

const Message = ({ message, viewer, data, nameOf, now }) => {
  const answers = viewer === MANAGER ? okAnswers(data.all, message, data.vanIds) : null;
  const incomingFromManager = viewer !== MANAGER && message.from === MANAGER;
  const answered = data.all.some((m) => m.from === viewer && m.re === message.id);
  return (
    <Box sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {`${nameOf(message.from)} → ${nameOf(message.to)} · ${formatTime.format(message.time)}`}
      </Typography>
      <Typography variant="body2" sx={textSx}>
        {message.text}
      </Typography>
      {answers && (
        <Typography variant="caption" component="div">
          {`OK: ${answers.ok.map(nameOf).join(', ') || '–'}`}
          {answers.missing.length > 0 && ` · Mangler: ${answers.missing.map(nameOf).join(', ')}`}
          {` · ${formatAge(Math.max(0, Math.round((now - message.time) / 1000)))}`}
        </Typography>
      )}
      {incomingFromManager &&
        (answered ? (
          <Typography variant="caption" color="success.main">
            OK sendt
          </Typography>
        ) : (
          <OkButton message={message} data={data} />
        ))}
    </Box>
  );
};

// The message button, banner and panel of one viewer (plan U6). `data` is the result of
// useMessages, called once by the page.
const MessagePanel = ({ viewer, data, buttonSx, bannerSx }) => {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const devices = useSelector((state) => state.devices.items);
  const now = useNow(10000);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [to, setTo] = useState(viewer === MANAGER ? ALL : MANAGER);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const endRef = useRef(null);

  const nameOf = (id) => {
    if (id === MANAGER) return 'Leder';
    if (id === ALL) return 'Alle biler';
    return devices[id]?.name ?? `Bil ${id}`;
  };

  const { messages, markRead, unread } = data;
  useEffect(() => {
    if (!open) return;
    markRead();
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages, markRead]);

  const incoming = messages.filter((m) => m.from !== viewer);
  const latest = incoming.at(-1);
  const banner =
    !open && unread > 0 && latest && latest.id !== dismissed && latest.id > (data.lastRead ?? 0);

  const submit = async () => {
    const problem = messageError(text);
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await data.send({ to, text });
      setText('');
    } catch (e) {
      setError(failure(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Fab
        size="medium"
        color="primary"
        aria-label="Meldinger"
        onClick={() => setOpen(true)}
        sx={{ position: 'absolute', zIndex: 4, ...buttonSx }}
      >
        <Badge badgeContent={unread} color="error">
          <ChatIcon />
        </Badge>
      </Fab>
      {banner && (
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            zIndex: 5,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(420px, calc(100vw - 32px))',
            display: 'flex',
            alignItems: 'flex-start',
            p: 1,
            ...bannerSx,
          }}
        >
          <Box sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => setOpen(true)}>
            <Typography variant="caption" color="text.secondary">
              {`${nameOf(latest.from)}${unread > 1 ? ` · ${unread} uleste` : ''}`}
            </Typography>
            <Typography variant="body2" noWrap>
              {latest.text}
            </Typography>
          </Box>
          <IconButton size="small" aria-label="Lukk" onClick={() => setDismissed(latest.id)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Paper>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} fullScreen={phone} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1 }}>
          <Box sx={{ flexGrow: 1 }}>Meldinger</Box>
          <IconButton aria-label="Lukk" onClick={() => setOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ py: 0 }}>
          {messages.length === 0 && !data.error && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Ingen meldinger
            </Typography>
          )}
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              viewer={viewer}
              data={data}
              nameOf={nameOf}
              now={now}
            />
          ))}
          {data.error && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <Typography variant="body2" color="error" sx={{ flexGrow: 1 }}>
                Kunne ikke hente meldingene.
              </Typography>
              <Button size="small" onClick={data.reload}>
                Last på nytt
              </Button>
            </Box>
          )}
          <div ref={endRef} />
        </DialogContent>
        <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {viewer === MANAGER && (
            <TextField
              select
              size="small"
              label="Til"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <MenuItem value={ALL}>Alle biler</MenuItem>
              {data.vanIds.map((id) => (
                <MenuItem key={id} value={id}>
                  {nameOf(id)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            multiline
            maxRows={4}
            size="small"
            label={viewer === MANAGER ? 'Melding' : 'Melding til leder'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { maxLength: MSG_MAX_LENGTH } }}
          />
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
          <Button variant="contained" disabled={sending} onClick={submit}>
            Send
          </Button>
        </Box>
      </Dialog>
    </>
  );
};

export default MessagePanel;
