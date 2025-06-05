// src/services/firebaseService.js
// ESTE SERVIÇO RODA NO RENDERER PROCESS e USA O SDK COMPAT (firebase.* global)
// Ele será importado pelos scripts do renderer que usam <script type="module">

class FirebaseService {
  constructor(firebaseConfig) {
    if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') {
      console.error('FirebaseService (ESM): SDK global do Firebase (firebase.initializeApp) não encontrado. Verifique os scripts no HTML.');
      throw new Error('FirebaseService (ESM): SDK do Firebase não carregado.');
    }

    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.error('FirebaseService (ESM): Configuração do Firebase inválida ou ausente na inicialização.');
      throw new Error('FirebaseService (ESM): Configuração do Firebase inválida.');
    }

    try {
      if (firebase.apps.length) {
        const existingApp = firebase.apps.find(app => app.name === '[DEFAULT]' && app.options.apiKey === firebaseConfig.apiKey);
        if (existingApp) {
          this.app = existingApp;
          // console.warn('FirebaseService (ESM): Usando instância Firebase app existente ([DEFAULT]) com a mesma configuração.');
        } else {
          this.app = firebase.initializeApp(firebaseConfig);
          // console.log('FirebaseService (ESM): Firebase app inicializada com a configuração fornecida (outras apps existentes).');
        }
      } else {
        this.app = firebase.initializeApp(firebaseConfig);
        // console.log('FirebaseService (ESM): Firebase app inicializada com a configuração fornecida.');
      }
    } catch (error) {
      if (error.code === 'app/duplicate-app') {
        this.app = firebase.app(); 
        // console.warn('FirebaseService (ESM): App Firebase já inicializado (erro de duplicata capturado), usando instância [DEFAULT] existente.');
      } else {
        console.error('FirebaseService (ESM): Erro ao inicializar Firebase (compat):', error);
        throw error;
      }
    }
    
    this.auth = this.app.auth();
    this.db = this.app.firestore();
  }

  // --- Métodos de Autenticação ---
  async login(email, password) {
    if (!this.auth) throw new Error("Firebase Auth não inicializado em FirebaseService.");
    return this.auth.signInWithEmailAndPassword(email, password);
  }

  async logout() {
    if (!this.auth) throw new Error("Firebase Auth não inicializado em FirebaseService.");
    return this.auth.signOut();
  }

  onAuthStateChanged(callback) {
    if (!this.auth) throw new Error("Firebase Auth não inicializado em FirebaseService.");
    return this.auth.onAuthStateChanged(callback);
  }

  getCurrentUser() {
    if (!this.auth) throw new Error("Firebase Auth não inicializado em FirebaseService.");
    return this.auth.currentUser;
  }

  // --- Métodos do Firestore ---
  async getUserDocument(uid) {
    if (!this.db) throw new Error("Firestore não inicializado em FirebaseService.");
    const userDocRef = this.db.collection('usuarios').doc(uid);
    return userDocRef.get();
  }

  async getCompanyDocument(empresaId) {
    if (!this.db) throw new Error("Firestore não inicializado em FirebaseService.");
    const empresaDocRef = this.db.collection('empresas').doc(empresaId);
    return empresaDocRef.get();
  }

  listenToDownloadingProjects(empresaId, successCallback, errorCallback) {
    if (!this.db) throw new Error("Firestore não inicializado em FirebaseService.");
    const projetosShortsRef = this.db.collection('empresas').doc(empresaId).collection('projetos_shorts');
    const q = projetosShortsRef.where("status", "==", "downloading");

    return q.onSnapshot(successCallback, (error) => {
      console.error("FirebaseService (ESM) (listenToDownloadingProjects): Erro no listener Firestore:", error);
      if (errorCallback) {
        errorCallback(error);
      }
    });
  }

  async updateProjectShortStatus(empresaId, projetoId, statusUpdate) {
    if (!this.db) throw new Error("Firestore não inicializado em FirebaseService.");
    const projetoDocRef = this.db.collection('empresas').doc(empresaId).collection('projetos_shorts').doc(projetoId);

    const dataToUpdate = {
      ...statusUpdate,
      processedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (statusUpdate.hasOwnProperty('errorMessage')) {
      if (statusUpdate.errorMessage === null || statusUpdate.errorMessage === undefined) {
        dataToUpdate.errorMessage = firebase.firestore.FieldValue.delete();
      } else {
        dataToUpdate.errorMessage = String(statusUpdate.errorMessage);
      }
    }

    return projetoDocRef.update(dataToUpdate);
  }
}

export default FirebaseService; // Já estava correto para ESM