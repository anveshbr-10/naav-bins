import { tk } from '../i18n';

// What each automatic check means, for the people reviewing it.
export const FLAG_INFO = {
  forged_qr:                { title: tk('Forged or tampered QR code'), hint: tk('A code with our prefix but a wrong signature was scanned.') },
  expired_qr:               { title: tk('Old live code (screenshot replay)'), hint: tk('A rotating code from a past period was scanned — usually a photo of the bin screen.') },
  printed_code_on_live_bin: { title: tk('Printed code on a live-QR bin'), hint: tk('Someone scanned an old printed code for a bin that now shows a live code.') },
  revoked_device_key:       { title: tk('Revoked bin screen key'), hint: tk('A code made with a replaced device key was scanned.') },
  unknown_bin:              { title: tk('Unregistered bin'), hint: tk('A validly signed code for a bin that is not in the fleet.') },
  geofence:                 { title: tk('Scanned away from the bin'), hint: tk('The phone was outside the bin\'s geofence.') },
  duplicate_photo:          { title: tk('Repeated photo'), hint: tk('The capture matched an earlier photo (perceptual hash).') },
  daily_cap:                { title: tk('Daily limit reached'), hint: tk('The user hit the daily item cap.') },
  weight_mismatch:          { title: tk('Weight does not match the item'), hint: tk('The bin\'s scale measured far more than the declared material weighs.') },
};
