import { useState } from 'react';
import { LoaderCircle, LogIn } from 'lucide-react';
import Modal from './Modal';
import { ApiError, loginAdmin } from '../lib/api';
import type { AuthSession } from '../lib/authTypes';

type LoginModalProps = {
  onClose: () => void;
  onSuccess: (session: AuthSession) => void;
};

export default function LoginModal({
  onClose,
  onSuccess,
}: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    try {
      const result = await loginAdmin(email, password);
      onSuccess({
        authenticated: true,
        user: result.user,
        csrfToken: result.csrfToken,
      });
    } catch (err) {
      const apiError = err instanceof ApiError ? err.body : undefined;
      const errorCode =
        typeof apiError === 'object' && apiError !== null && 'error' in apiError
          ? String((apiError as { error: unknown }).error)
          : undefined;

      setError(
        errorCode === 'login_rate_limited'
          ? 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.'
          : errorCode === 'csrf_failed'
            ? 'La sesión de seguridad expiró. Cerrá este formulario y volvé a abrirlo.'
            : 'El email o la contraseña no son correctos.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Iniciar sesión"
      onClose={onClose}
      closeDisabled={submitting}
      className="login-modal"
    >
      <form className="login-form" onSubmit={handleSubmit}>
        <p className="login-intro">
          Ingresá con una cuenta de administrador para gestionar la red.
        </p>

        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            required
            autoFocus
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
          />
        </label>

        {error && <p className="form-error login-error">{error}</p>}

        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? <LoaderCircle className="bulk-spin" size={16} /> : <LogIn size={16} />}
            {submitting ? 'Verificando…' : 'Iniciar sesión'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
