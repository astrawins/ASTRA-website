// sepa.js — μήνυμα ακύρωσης της διαδικασίας SEPA (εξωτερικό αρχείο για το CSP).
if (new URLSearchParams(location.search).get('ok') === '0') {
    document.getElementById('t').textContent = 'Η διαδικασία ακυρώθηκε';
    document.getElementById('d').textContent = 'Δεν έγινε καμία αλλαγή. Μπορείτε να χρησιμοποιήσετε ξανά τον σύνδεσμο που σας στείλαμε όποτε θέλετε.';
  }
